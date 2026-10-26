import { SVGPathData } from "../../node_modules/svg-pathdata/lib/SVGPathData.module.js";
import { createDocument } from "./document.js";
import { DEFAULT_LAYER } from "./layers.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const UNIT_TO_MM = { mm: 1, cm: 10, in: 25.4, px: 25.4 / 96, pt: 25.4 / 72, pc: 25.4 / 6 };
const PRESENTATION_ATTRIBUTES = new Set([
  "fill", "stroke", "stroke-width", "fill-rule", "stroke-linecap", "stroke-linejoin",
  "opacity", "fill-opacity", "stroke-opacity"
]);
const GEOMETRY_ATTRIBUTES = {
  rect: new Set(["x", "y", "width", "height", "rx", "ry"]),
  circle: new Set(["cx", "cy", "r"]),
  ellipse: new Set(["cx", "cy", "rx", "ry"]),
  line: new Set(["x1", "y1", "x2", "y2"]),
  path: new Set(["d"]),
  polygon: new Set(["points"]),
  polyline: new Set(["points"]),
  text: new Set(["x", "y", "font-size", "font-family", "text-anchor", "dominant-baseline", "transform"])
};
const ROOT_ATTRIBUTES = new Set(["xmlns", "width", "height", "viewBox", "version", "preserveAspectRatio"]);

export function validateSvgSource(source) {
  if (typeof source !== "string") fail("source must be text.");
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) fail("DOCTYPE and entity declarations are not supported.");
}

function fail(message) {
  throw new Error(`SVG import: ${message}`);
}

function number(value, label, fallback = 0) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) {
    fail(`${label} must be a finite SVG number without a unit.`);
  }
  const result = Number(value);
  if (!Number.isFinite(result)) fail(`${label} must be finite.`);
  return result;
}

function lengthMm(value, label) {
  if (value === undefined) return undefined;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(mm|cm|in|px|pt|pc)?$/i.exec(value.trim());
  if (!match) fail(`${label} must use mm, cm, in, px, pt, or pc.`);
  const result = Number(match[1]) * UNIT_TO_MM[(match[2] ?? "px").toLowerCase()];
  if (!Number.isFinite(result) || result <= 0) fail(`${label} must be greater than zero.`);
  return result;
}

function checkedAttributes(node, allowed, label) {
  for (const name of Object.keys(node.attributes ?? {})) {
    if (name === "transform" && !allowed.has(name)) fail(`transform attributes are not supported yet (${label}).`);
    if (!allowed.has(name) && !PRESENTATION_ATTRIBUTES.has(name) && name !== "id") {
      fail(`unsupported ${label} attribute "${name}".`);
    }
  }
}

function multiplyTransforms(left, right) {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f
  ];
}

function parseTransform(value) {
  if (value === undefined) return [1, 0, 0, 1, 0, 0];
  const transformPattern = /([A-Za-z]+)\s*\(([^()]*)\)/g;
  let result = [1, 0, 0, 1, 0, 0];
  let consumed = 0;
  let match;
  while ((match = transformPattern.exec(value))) {
    if (value.slice(consumed, match.index).replace(/[\s,]+/g, "")) fail("transform syntax is invalid.");
    const argsText = match[2].trim();
    const args = argsText ? argsText.split(/[\s,]+/).map((token) => number(token, "transform")) : [];
    let next;
    if (match[1] === "matrix" && args.length === 6) {
      next = args;
    } else if (match[1] === "translate" && (args.length === 1 || args.length === 2)) {
      next = [1, 0, 0, 1, args[0], args[1] ?? 0];
    } else if (match[1] === "scale" && (args.length === 1 || args.length === 2)) {
      next = [args[0], 0, 0, args[1] ?? args[0], 0, 0];
    } else if (match[1] === "rotate" && (args.length === 1 || args.length === 3)) {
      const radians = args[0] * Math.PI / 180;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      next = [cosine, sine, -sine, cosine, 0, 0];
      if (args.length === 3) {
        next = multiplyTransforms(
          multiplyTransforms([1, 0, 0, 1, args[1], args[2]], next),
          [1, 0, 0, 1, -args[1], -args[2]]
        );
      }
    } else if (match[1] === "skewX" && args.length === 1) {
      next = [1, 0, Math.tan(args[0] * Math.PI / 180), 1, 0, 0];
    } else if (match[1] === "skewY" && args.length === 1) {
      next = [1, Math.tan(args[0] * Math.PI / 180), 0, 1, 0, 0];
    } else {
      fail(`unsupported or malformed text transform "${match[1]}".`);
    }
    if (!next.every(Number.isFinite)) fail("text transform values must be finite.");
    result = multiplyTransforms(result, next);
    consumed = transformPattern.lastIndex;
  }
  if (consumed === 0 || value.slice(consumed).replace(/[\s,]+/g, "")) fail("transform syntax is invalid.");
  return result;
}

function mapTextTransform(view, transform) {
  const [a, b, c, d, e, f] = transform;
  const matrix = [
    view.scaleX * a,
    view.scaleY * b,
    view.scaleX * c,
    view.scaleY * d,
    view.mapX(e),
    view.mapY(f)
  ];
  const [mappedA, mappedB, mappedC, mappedD] = matrix;
  const firstScale = Math.hypot(mappedA, mappedB);
  const secondScale = Math.hypot(mappedC, mappedD);
  const tolerance = Math.max(firstScale, secondScale) * 1e-8;
  if (firstScale === 0 || secondScale === 0 || Math.abs(firstScale - secondScale) > tolerance
    || Math.abs(mappedA * mappedC + mappedB * mappedD) > tolerance * Math.max(firstScale, secondScale)
    || mappedA * mappedD - mappedB * mappedC <= 0) {
    fail("text transforms must preserve uniform scale and orientation; non-uniform scale, skew, and reflection are not supported.");
  }
  return {
    scale: (firstScale + secondScale) / 2,
    rotationDeg: Math.atan2(mappedB, mappedA) * 180 / Math.PI
  };
}

function parseViewBox(value) {
  if (value === undefined) return null;
  const values = value.trim().split(/[\s,]+/).map((entry) => Number(entry));
  if (values.length !== 4 || !values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) {
    fail("viewBox must contain four finite values with positive width and height.");
  }
  return { x: values[0], y: values[1], width: values[2], height: values[3] };
}

function viewport(root) {
  checkedAttributes(root, ROOT_ATTRIBUTES, "root");
  if (root.attributes.xmlns && root.attributes.xmlns !== SVG_NAMESPACE) fail("the root namespace is not SVG.");
  const viewBox = parseViewBox(root.attributes.viewBox);
  const widthAttr = lengthMm(root.attributes.width, "width");
  const heightAttr = lengthMm(root.attributes.height, "height");
  let widthMm = widthAttr;
  let heightMm = heightAttr;

  if (viewBox && widthMm === undefined && heightMm === undefined) {
    widthMm = viewBox.width;
    heightMm = viewBox.height;
  } else if (viewBox && widthMm === undefined) {
    widthMm = heightMm * viewBox.width / viewBox.height;
  } else if (viewBox && heightMm === undefined) {
    heightMm = widthMm * viewBox.height / viewBox.width;
  } else {
    widthMm ??= 300 * UNIT_TO_MM.px;
    heightMm ??= 150 * UNIT_TO_MM.px;
  }

  const userWidth = viewBox?.width ?? widthMm / UNIT_TO_MM.px;
  const userHeight = viewBox?.height ?? heightMm / UNIT_TO_MM.px;
  const originX = viewBox?.x ?? 0;
  const originY = viewBox?.y ?? 0;
  let scaleX = widthMm / userWidth;
  let scaleY = heightMm / userHeight;
  let offsetX = 0;
  let offsetY = 0;
  const aspect = (root.attributes.preserveAspectRatio ?? "xMidYMid meet").trim();
  if (aspect !== "none") {
    const match = /^(?:x(Min|Mid|Max)Y(Min|Mid|Max))?(?:\s+(meet))?$/.exec(aspect);
    if (!match) fail("preserveAspectRatio supports none or xMin/xMid/xMaxYMin/YMid/YMax meet.");
    const scale = Math.min(scaleX, scaleY);
    const spareX = widthMm - userWidth * scale;
    const spareY = heightMm - userHeight * scale;
    const alignX = match[1]?.startsWith("xMin") ? 0 : match[1]?.startsWith("xMax") ? 1 : 0.5;
    const alignY = match[1]?.endsWith("Min") ? 0 : match[1]?.endsWith("Max") ? 1 : 0.5;
    scaleX = scale;
    scaleY = scale;
    offsetX = spareX * alignX;
    offsetY = spareY * alignY;
  }
  return {
    widthMm, heightMm, originX, originY, scaleX, scaleY, offsetX, offsetY,
    mapX: (x) => (x - originX) * scaleX + offsetX,
    mapY: (y) => (y - originY) * scaleY + offsetY
  };
}

function parsePoints(value) {
  if (typeof value !== "string" || !value.trim()) fail("polygon/polyline points are required.");
  const tokens = value.trim().match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) ?? [];
  const residue = value.replace(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi, "").replace(/[\s,]+/g, "");
  if (residue || tokens.length < 4 || tokens.length % 2 !== 0) fail("polygon/polyline points must be coordinate pairs.");
  const points = tokens.map(Number);
  if (!points.every(Number.isFinite)) fail("polygon/polyline points must be finite.");
  return points;
}

function localPath(pathData, view) {
  if (pathData.length > 1_000_000) fail("path data exceeds the 1000000 character limit.");
  let path;
  try {
    path = new SVGPathData(pathData).toAbs();
  } catch (error) {
    fail(`invalid path data: ${error.message}`);
  }
  path.translate(-view.originX, -view.originY)
    .scale(view.scaleX, view.scaleY)
    .translate(view.offsetX, view.offsetY);
  const bounds = path.getBounds();
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) {
    fail("path must contain drawable geometry.");
  }
  path.translate(-bounds.minX, -bounds.minY);
  return {
    pathData: path.encode(),
    xMm: bounds.minX,
    yMm: bounds.minY,
    widthMm: bounds.maxX - bounds.minX,
    heightMm: bounds.maxY - bounds.minY
  };
}

export function importSvgTree(root, { layerId = "layer-engrave", idPrefix = "svg" } = {}) {
  if (!root || root.name !== "svg" || root.type !== "element") fail("the document must have an <svg> root.");
  const view = viewport(root);
  const elements = [];
  const stack = root.children.map((node) => ({ node, depth: 1 })).reverse();
  let count = 0;

  while (stack.length) {
    const { node, depth } = stack.pop();
    if (node.type === "text") {
      if (node.value.trim()) fail("text must be inside a supported <text> element.");
      continue;
    }
    count += 1;
    if (count > 20000 || depth > 64) fail("the SVG exceeds the 20000 element or 64-level nesting limit.");
    if (node.name === "g") {
      checkedAttributes(node, new Set(["id"]), "group");
      stack.push(...node.children.map((child) => ({ node: child, depth: depth + 1 })).reverse());
      continue;
    }
    const allowed = GEOMETRY_ATTRIBUTES[node.name];
    if (!allowed) fail(`unsupported element <${node.name}>.`);
    checkedAttributes(node, allowed, `<${node.name}>`);
    const a = node.attributes ?? {};
    const id = `${idPrefix}-${elements.length + 1}`;
    const common = { id, layerId, rotationDeg: 0, skewXDeg: 0, skewYDeg: 0 };
    const x = (value, label) => view.mapX(number(value, label));
    const y = (value, label) => view.mapY(number(value, label));

    if (node.name === "rect") {
      if (number(a.rx, "rx") !== 0 || number(a.ry, "ry") !== 0) fail("rounded rectangles are not supported.");
      const widthMm = number(a.width, "rect width", NaN) * view.scaleX;
      const heightMm = number(a.height, "rect height", NaN) * view.scaleY;
      if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
        fail("rect width and height must be positive finite values.");
      }
      elements.push({ ...common, type: "rect", xMm: x(a.x, "rect x"), yMm: y(a.y, "rect y"), widthMm, heightMm });
    } else if (node.name === "circle" || node.name === "ellipse") {
      const cx = number(a.cx, `${node.name} cx`);
      const cy = number(a.cy, `${node.name} cy`);
      const radiusX = number(node.name === "circle" ? a.r : a.rx, `${node.name} rx`, NaN);
      const radiusY = number(node.name === "circle" ? a.r : a.ry, `${node.name} ry`, NaN);
      if (![radiusX, radiusY].every((radius) => Number.isFinite(radius) && radius > 0)) fail(`${node.name} radii must be positive.`);
      const widthMm = radiusX * 2 * view.scaleX;
      const heightMm = radiusY * 2 * view.scaleY;
      elements.push({
        ...common, type: "ellipse", xMm: view.mapX(cx - radiusX), yMm: view.mapY(cy - radiusY), widthMm, heightMm
      });
    } else if (node.name === "text") {
      if (node.children.some((child) => child.type !== "text")) fail("nested markup inside <text> is not supported.");
      const text = node.children.map((child) => child.value).join("");
      const size = number(a["font-size"], "text font-size", 16);
      if (size <= 0) fail("text font-size must be positive.");
      if (a["text-anchor"] && a["text-anchor"] !== "start") fail("text-anchor values other than start are not supported.");
      if (a["dominant-baseline"] && a["dominant-baseline"] !== "auto") fail("custom text baselines are not supported.");
      const textMatrix = parseTransform(a.transform);
      const transform = mapTextTransform(view, textMatrix);
      const xUser = number(a.x, "text x");
      const yUser = number(a.y, "text y");
      const [aTransform, bTransform, cTransform, dTransform, eTransform, fTransform] = textMatrix;
      elements.push({
        ...common, type: "text",
        xMm: view.mapX(aTransform * xUser + cTransform * yUser + eTransform),
        yMm: view.mapY(bTransform * xUser + dTransform * yUser + fTransform),
        text, fontSizeMm: size * transform.scale, fontFamily: a["font-family"] ?? "sans-serif",
        rotationDeg: transform.rotationDeg
      });
    } else {
      let pathData;
      if (node.name === "path") {
        if (typeof a.d !== "string" || !a.d.trim()) fail("path data (d) is required.");
        pathData = a.d;
      } else if (node.name === "line") {
        pathData = `M ${number(a.x1, "line x1")} ${number(a.y1, "line y1")} L ${number(a.x2, "line x2")} ${number(a.y2, "line y2")}`;
      } else {
        const points = parsePoints(a.points);
        pathData = `M ${points[0]} ${points[1]} ${points.slice(2).reduce((commands, value, index) => {
          if (index % 2 === 0) commands.push(`L ${value}`);
          else commands[commands.length - 1] += ` ${value}`;
          return commands;
        }, []).join(" ")}${node.name === "polygon" ? " Z" : ""}`;
      }
      const shape = localPath(pathData, view);
      if (shape.widthMm === 0 && shape.heightMm === 0) fail("paths must have a positive width or height.");
      elements.push({ ...common, type: "path", ...shape });
    }
  }

  if (elements.length === 0) fail("no supported editable geometry was found.");
  const normalized = createDocument({
    widthMm: view.widthMm,
    heightMm: view.heightMm,
    layers: [{ ...DEFAULT_LAYER, id: layerId }],
    elements
  });
  return { widthMm: normalized.widthMm, heightMm: normalized.heightMm, elements: normalized.elements };
}
