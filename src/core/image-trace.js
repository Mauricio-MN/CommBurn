import { SVGPathData } from "../../node_modules/svg-pathdata/lib/SVGPathData.module.js";
import { importSvgTree } from "./svg-import.js";
import { CommBurnRangeError, CommBurnTypeError } from "./i18n.js";

const MAX_PATHS = 15_000;
const MAX_PATH_DATA_LENGTH = 1_000_000;
// Import re-encodes coordinates in millimetres, which can lengthen path data; split traced paths well below the element limit.
const TRACE_PATH_BUDGET = 250_000;

function positiveFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new CommBurnRangeError("imageTrace.invalidDimension", { label }, { message: `${label} must be a finite number greater than zero` });
  }
  return value;
}

function cloneNode(node) {
  return {
    ...node,
    attributes: { ...node.attributes },
    children: (node.children ?? []).map(cloneNode)
  };
}

function removeTracerStrokes(node) {
  if (node.name === "path") {
    delete node.attributes.stroke;
    delete node.attributes["stroke-width"];
  }
  for (const child of node.children ?? []) removeTracerStrokes(child);
}

function traceSubpaths(pathData) {
  const path = new SVGPathData(pathData).toAbs().normalizeHVZ().normalizeST().qtToC().aToC();
  const groups = [];
  for (const command of path.commands) {
    if (command.type === SVGPathData.MOVE_TO || groups.length === 0) groups.push([]);
    groups.at(-1).push(command);
  }
  return groups.filter((commands) => commands.length > 1).map((commands) => {
    const points = commands
      .filter((command) => Number.isFinite(command.x) && Number.isFinite(command.y))
      .map((command) => [command.x, command.y]);
    const piece = new SVGPathData("");
    piece.commands = commands;
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return {
      text: piece.encode(),
      points,
      area: polygonArea(points),
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys)
    };
  });
}

function polygonArea(points) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    sum += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  }
  return Math.abs(sum) / 2;
}

function containsPoint(outer, [px, py]) {
  if (px < outer.minX || px > outer.maxX || py < outer.minY || py > outer.maxY) return false;
  let inside = false;
  for (let i = 0, j = outer.points.length - 1; i < outer.points.length; j = i, i += 1) {
    const [xi, yi] = outer.points[i];
    const [xj, yj] = outer.points[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Each group is one outermost contour with every hole and island nested inside it, so fill rules keep the same result.
// Containment is transitive, so testing a subpath only against the outermost regions found so far is enough.
function groupByContainment(subpaths) {
  const sorted = [...subpaths].sort((a, b) => b.area - a.area);
  const regions = [];
  const groups = [];
  for (const subpath of sorted) {
    const owner = regions.findIndex((region) => containsPoint(region, subpath.points[0]));
    if (owner < 0) {
      regions.push(subpath);
      groups.push([subpath]);
    } else {
      groups[owner].push(subpath);
    }
  }
  return groups;
}

function packTraceGroups(groups) {
  const chunks = [];
  let current = [];
  let currentLength = 0;
  for (const group of groups) {
    const text = group.map((subpath) => subpath.text).join(" ");
    if (text.length > TRACE_PATH_BUDGET) {
      throw new CommBurnRangeError("imageTrace.tooLarge", {}, { message: "A traced region is too detailed to convert; reduce the detail or the image size" });
    }
    if (currentLength > 0 && currentLength + text.length + 1 > TRACE_PATH_BUDGET) {
      chunks.push(current.join(" "));
      current = [];
      currentLength = 0;
    }
    current.push(text);
    currentLength += text.length + 1;
  }
  if (current.length > 0) chunks.push(current.join(" "));
  return chunks;
}

function splitOversizedTracePaths(node) {
  node.children = (node.children ?? []).flatMap((child) => {
    if (child.name === "path" && typeof child.attributes?.d === "string" && child.attributes.d.length > TRACE_PATH_BUDGET) {
      const groups = groupByContainment(traceSubpaths(child.attributes.d));
      return packTraceGroups(groups).map((d) => ({ ...child, attributes: { ...child.attributes, d }, children: [] }));
    }
    splitOversizedTracePaths(child);
    return [child];
  });
}

export function importTracedImageSvg(tree, options) {
  const widthMm = positiveFinite(options.widthMm, "widthMm");
  const heightMm = positiveFinite(options.heightMm, "heightMm");
  const xMm = options.xMm ?? 0;
  const yMm = options.yMm ?? 0;
  for (const [label, value] of [["xMm", xMm], ["yMm", yMm]]) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new CommBurnRangeError("imageTrace.invalidPosition", { label }, { message: `${label} must be finite` });
    }
  }
  const sourceLayer = options.sourceLayer;
  if (!sourceLayer || sourceLayer.locked) {
    throw new CommBurnRangeError("imageTrace.lockedLayer", {}, { message: "image vectors require an unlocked layer" });
  }

  const root = cloneNode(tree);
  if (root.name !== "svg" || root.type !== "element") {
    throw new CommBurnTypeError("imageTrace.invalidRoot", {}, { message: "Image tracer output must have an SVG root" });
  }
  removeTracerStrokes(root);
  splitOversizedTracePaths(root);
  delete root.attributes.desc;
  root.attributes.width = `${widthMm}mm`;
  root.attributes.height = `${heightMm}mm`;
  root.attributes.preserveAspectRatio = "none";

  const imported = importSvgTree(root, {
    layerId: sourceLayer.id,
    fallbackLayer: sourceLayer,
    idPrefix: options.idPrefix
  });
  const colorsByLayer = new Map(imported.layers.map((layer) => [layer.id, layer.color]));
  const elements = imported.elements.map((element) => {
    if (element.type !== "path") {
      throw new CommBurnTypeError("imageTrace.invalidGeometry", {}, { message: "Image tracer output contains non-path geometry" });
    }
    const color = colorsByLayer.get(element.layerId);
    if (!color) {
      throw new CommBurnRangeError("imageTrace.missingColor", { layerId: element.layerId }, { message: `Traced path refers to missing color "${element.layerId}"` });
    }
    return { ...element, layerId: sourceLayer.id, color };
  });
  if (elements.some((element) => element.pathData.length > MAX_PATH_DATA_LENGTH)) {
    throw new CommBurnRangeError("imageTrace.tooLarge", { maxLength: MAX_PATH_DATA_LENGTH }, { message: "A traced region is too detailed to convert; reduce the detail or the image size" });
  }
  if (elements.length > MAX_PATHS) {
    throw new CommBurnRangeError("imageTrace.tooManyPaths", { maxPaths: MAX_PATHS }, { message: `Image tracing creates more than ${MAX_PATHS} paths; reduce the color count or detail` });
  }
  if (elements.length === 0) {
    throw new CommBurnRangeError("imageTrace.noRegions", {}, { message: "Image tracing produced no vector regions" });
  }
  const bounds = elements.reduce((result, element) => ({
    minX: Math.min(result.minX, element.xMm),
    minY: Math.min(result.minY, element.yMm),
    maxX: Math.max(result.maxX, element.xMm + element.widthMm),
    maxY: Math.max(result.maxY, element.yMm + element.heightMm)
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const tracedWidthMm = bounds.maxX - bounds.minX;
  const tracedHeightMm = bounds.maxY - bounds.minY;
  if (![tracedWidthMm, tracedHeightMm].every(Number.isFinite) || tracedWidthMm <= 0 || tracedHeightMm <= 0) {
    throw new CommBurnRangeError("imageTrace.invalidBounds", {}, { message: "Image tracing produced invalid vector bounds" });
  }
  const scaleX = widthMm / tracedWidthMm;
  const scaleY = heightMm / tracedHeightMm;
  const fitToSourceImage = (element) => {
    const left = element.xMm === bounds.minX ? 0 : (element.xMm - bounds.minX) * scaleX;
    const top = element.yMm === bounds.minY ? 0 : (element.yMm - bounds.minY) * scaleY;
    const right = element.xMm + element.widthMm === bounds.maxX
      ? widthMm
      : (element.xMm + element.widthMm - bounds.minX) * scaleX;
    const bottom = element.yMm + element.heightMm === bounds.maxY
      ? heightMm
      : (element.yMm + element.heightMm - bounds.minY) * scaleY;
    return {
      ...element,
      xMm: xMm + left,
      yMm: yMm + top,
      widthMm: right - left,
      heightMm: bottom - top
    };
  };
  const fittedElements = elements.map(fitToSourceImage);
  return {
    elements: fittedElements,
    stats: {
      pathCount: fittedElements.length,
      colorCount: new Set(fittedElements.map((element) => element.color)).size
    }
  };
}
