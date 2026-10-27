import { DEFAULT_LAYER, normalizeLayers } from "./layers.js";
import { SVGPathData } from "../../node_modules/svg-pathdata/lib/SVGPathData.module.js";

const ORIGIN_CORNERS = new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number of millimetres`);
  }
  return value;
}

function positiveNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number <= 0) throw new RangeError(`${label} must be greater than zero`);
  return number;
}

function normalizeTransforms(element, id) {
  const rotationDeg = finiteNumber(element.rotationDeg ?? 0, `Element ${id} rotationDeg`);
  const skewXDeg = finiteNumber(element.skewXDeg ?? 0, `Element ${id} skewXDeg`);
  const skewYDeg = finiteNumber(element.skewYDeg ?? 0, `Element ${id} skewYDeg`);
  if (Math.abs(skewXDeg) >= 80 || Math.abs(skewYDeg) >= 80) {
    throw new RangeError(`Element ${id} warp angles must be between -80 and 80 degrees`);
  }
  return { rotationDeg, skewXDeg, skewYDeg };
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function normalizeImageDataUri(value, id) {
  if (typeof value !== "string") throw new TypeError(`Element ${id} imageDataUri must be an embedded PNG, JPEG, or WebP image`);
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) {
    throw new TypeError(`Element ${id} imageDataUri must be an embedded PNG, JPEG, or WebP image`);
  }
  let bytes;
  try {
    bytes = atob(match[2]);
  } catch (error) {
    throw new TypeError(`Element ${id} imageDataUri has invalid base64 data`, { cause: error });
  }
  if (bytes.length > 25 * 1024 * 1024) throw new RangeError(`Element ${id} imageDataUri exceeds 25 MB`);
  const signature = [...bytes.slice(0, 12)].map((byte) => byte.charCodeAt(0));
  const validSignature = match[1] === "png"
    ? signature.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10"
    : match[1] === "jpeg"
      ? signature[0] === 255 && signature[1] === 216 && signature[2] === 255
      : signature.slice(0, 4).join("") === "RIFF" && signature.slice(8, 12).join("") === "WEBP";
  if (!validSignature) throw new TypeError(`Element ${id} imageDataUri does not match its image format`);
  return value;
}

function normalizeSvgDataUri(value, id, nestingDepth = 0) {
  if (typeof value !== "string") throw new TypeError(`Element ${id} svgDataUri must be an embedded sanitized SVG`);
  const match = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1].length % 4 !== 0) {
    throw new TypeError(`Element ${id} svgDataUri must be an embedded sanitized SVG`);
  }
  if (nestingDepth > 8) throw new RangeError(`Element ${id} svgDataUri exceeds the nested SVG limit`);
  let source;
  try {
    const bytes = atob(match[1]);
    if (bytes.length > 10 * 1024 * 1024) throw new RangeError(`Element ${id} svgDataUri exceeds 10 MB`);
    source = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes, (byte) => byte.charCodeAt(0)));
  } catch (error) {
    if (error instanceof RangeError) throw error;
    throw new TypeError(`Element ${id} svgDataUri has invalid encoded XML`, { cause: error });
  }
  const unsafeMarkup = /<!DOCTYPE\b|<!ENTITY\b|<\s*(?:script|iframe|object|embed|audio|video|handler|listener)\b|\son[a-z]+\s*=|xml:base\s*=|&(?!(?:amp|lt|gt|quot|apos);)[A-Za-z_:][A-Za-z0-9_.:-]*;/i;
  const externalReference = /(?:href|src)\s*=\s*["'](?!\s*(?:#|data:image\/(?:svg\+xml|png|jpeg|webp);base64,))|url\(\s*["']?(?!#|data:image\/(?:svg\+xml|png|jpeg|webp);base64,)|@import\b/i;
  if (!/^<svg(?:\s|>)/i.test(source) || unsafeMarkup.test(source) || externalReference.test(source)) {
    throw new TypeError(`Element ${id} svgDataUri contains unsupported active or external content`);
  }
  for (const nested of source.matchAll(/data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}/gi)) {
    normalizeSvgDataUri(nested[0], id, nestingDepth + 1);
  }
  return value;
}

function normalizeImageAspect(value, id) {
  const aspect = value ?? "xMidYMid meet";
  if (aspect !== "none" && !/^x(?:Min|Mid|Max)Y(?:Min|Mid|Max) meet$/.test(aspect)) {
    throw new RangeError(`Element ${id} has an unsupported image preserveAspectRatio`);
  }
  return aspect;
}

function normalizeOrigin(origin = {}) {
  const corner = origin.corner ?? "top-left";
  if (!ORIGIN_CORNERS.has(corner)) throw new RangeError(`Unsupported origin corner: ${corner}`);
  const flipX = origin.flipX ?? false;
  const flipY = origin.flipY ?? false;
  if (typeof flipX !== "boolean" || typeof flipY !== "boolean") {
    throw new TypeError("Axis inversion settings must be boolean");
  }
  return { corner, flipX, flipY };
}

function normalizeElement(element, index, defaultLayerId) {
  if (!element || typeof element !== "object" || Array.isArray(element)) {
    throw new TypeError(`Element ${index} must be an object`);
  }
  const id = String(element.id ?? `element-${index + 1}`);
  const xMm = finiteNumber(element.xMm, `Element ${id} xMm`);
  const yMm = finiteNumber(element.yMm, `Element ${id} yMm`);
  const transforms = normalizeTransforms(element, id);
  const layerId = String(element.layerId ?? defaultLayerId);

  if (element.type === "text") {
    if (typeof element.text !== "string") throw new TypeError(`Element ${id} text must be a string`);
    return {
      id, type: "text", xMm, yMm, text: element.text,
      fontSizeMm: positiveNumber(element.fontSizeMm, `Element ${id} fontSizeMm`),
      fontFamily: String(element.fontFamily ?? "sans-serif"),
      layerId,
      ...transforms
    };
  }
  if (element.type === "rect") {
    return {
      id, type: "rect", xMm, yMm,
      widthMm: positiveNumber(element.widthMm, `Element ${id} widthMm`),
      heightMm: positiveNumber(element.heightMm, `Element ${id} heightMm`),
      layerId,
      ...transforms
    };
  }
  if (element.type === "ellipse") {
    return {
      id, type: "ellipse", xMm, yMm,
      widthMm: positiveNumber(element.widthMm, `Element ${id} widthMm`),
      heightMm: positiveNumber(element.heightMm, `Element ${id} heightMm`),
      layerId,
      ...transforms
    };
  }
  if (element.type === "line") {
    const widthMm = finiteNumber(element.widthMm, `Element ${id} widthMm`);
    const heightMm = finiteNumber(element.heightMm, `Element ${id} heightMm`);
    if (widthMm < 0 || heightMm < 0 || (widthMm === 0 && heightMm === 0)) {
      throw new RangeError(`Element ${id} line must have a positive length`);
    }
    return { id, type: "line", xMm, yMm, widthMm, heightMm, layerId, ...transforms };
  }
  if (element.type === "path") {
    if (typeof element.pathData !== "string" || !element.pathData.trim()) {
      throw new TypeError(`Element ${id} pathData must be a non-empty SVG path`);
    }
    if (element.pathData.length > 1_000_000) throw new RangeError(`Element ${id} pathData exceeds the 1000000 character limit`);
    let path;
    try {
      path = new SVGPathData(element.pathData);
    } catch (error) {
      throw new TypeError(`Element ${id} pathData is invalid: ${error.message}`, { cause: error });
    }
    const bounds = path.getBounds();
    if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
      || bounds.minX < -1e9 || bounds.minY < -1e9 || bounds.maxX > 1e9 || bounds.maxY > 1e9) {
      throw new RangeError(`Element ${id} path coordinates must be finite and within ±1000000000 mm`);
    }
    const widthMm = positiveOrZero(element.widthMm ?? bounds.maxX - bounds.minX, `Element ${id} widthMm`);
    const heightMm = positiveOrZero(element.heightMm ?? bounds.maxY - bounds.minY, `Element ${id} heightMm`);
    if (widthMm === 0 && heightMm === 0) throw new RangeError(`Element ${id} path must have a positive width or height`);
    const powerPercent = element.powerPercent;
    if (powerPercent !== undefined
      && (typeof powerPercent !== "number" || !Number.isFinite(powerPercent) || powerPercent <= 0 || powerPercent > 100)) {
      throw new RangeError(`Element ${id} powerPercent must be greater than zero and at most 100`);
    }
    return {
      id, type: "path", xMm, yMm, widthMm, heightMm, pathData: element.pathData, layerId,
      ...(powerPercent === undefined ? {} : { powerPercent }),
      ...transforms
    };
  }
  if (element.type === "image") {
    return {
      id, type: "image", xMm, yMm,
      widthMm: positiveNumber(element.widthMm, `Element ${id} widthMm`),
      heightMm: positiveNumber(element.heightMm, `Element ${id} heightMm`),
      imageDataUri: normalizeImageDataUri(element.imageDataUri, id),
      preserveAspectRatio: normalizeImageAspect(element.preserveAspectRatio, id),
      layerId,
      ...transforms
    };
  }
  if (element.type === "svg-image") {
    return {
      id, type: "svg-image", xMm, yMm,
      widthMm: positiveNumber(element.widthMm, `Element ${id} widthMm`),
      heightMm: positiveNumber(element.heightMm, `Element ${id} heightMm`),
      svgDataUri: normalizeSvgDataUri(element.svgDataUri, id),
      layerId,
      ...transforms
    };
  }
  throw new RangeError(`Element ${id} has unsupported type: ${element.type}`);
}

function positiveOrZero(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0) throw new RangeError(`${label} must not be negative`);
  return number;
}

export function createDocument(input = {}) {
  const widthMm = positiveNumber(input.widthMm ?? 100, "widthMm");
  const heightMm = positiveNumber(input.heightMm ?? 100, "heightMm");
  const elements = input.elements ?? [];
  if (!Array.isArray(elements)) throw new TypeError("elements must be an array");
  const layers = normalizeLayers(input.layers ?? [DEFAULT_LAYER]);
  const layerIds = new Set(layers.map((layer) => layer.id));
  const normalizedElements = elements.map((element, index) => normalizeElement(element, index, layers[0].id));
  const ids = new Set();
  for (const element of normalizedElements) {
    if (!element.id.trim()) throw new RangeError("Object ids must not be empty");
    if (ids.has(element.id)) throw new RangeError(`Duplicate object id: ${element.id}`);
    if (!layerIds.has(element.layerId)) {
      throw new RangeError(`Element ${element.id} references unknown layer: ${element.layerId}`);
    }
    ids.add(element.id);
  }
  return { widthMm, heightMm, origin: normalizeOrigin(input.origin), layers, elements: normalizedElements };
}

export function mapDocumentPoint(document, xMm, yMm) {
  const originAtRight = document.origin.corner.endsWith("right");
  const originAtBottom = document.origin.corner.startsWith("bottom");
  const flipX = originAtRight !== document.origin.flipX;
  const flipY = originAtBottom !== document.origin.flipY;
  return {
    xMm: flipX ? document.widthMm - xMm : xMm,
    yMm: flipY ? document.heightMm - yMm : yMm,
    flipX,
    flipY
  };
}

function transformAttribute(element, centerX, centerY) {
  const { rotationDeg, skewXDeg, skewYDeg } = element;
  if (rotationDeg === 0 && skewXDeg === 0 && skewYDeg === 0) return "";
  return ` transform="translate(${centerX} ${centerY}) rotate(${rotationDeg}) skewX(${skewXDeg}) skewY(${skewYDeg}) translate(${-centerX} ${-centerY})"`;
}

export function renderSvg(input) {
  const document = createDocument(input);
  const nodesByLayer = new Map(document.layers.map((layer) => [layer.id, []]));
  for (const element of document.elements) {
    const layer = document.layers.find((candidate) => candidate.id === element.layerId);
    if (!layer.visible) continue;
    const point = mapDocumentPoint(document, element.xMm, element.yMm);
    const fill = layer.operation === "fill" ? layer.color : "none";
    if (element.type === "text") {
      const transform = transformAttribute(element, point.xMm, point.yMm);
      nodesByLayer.get(layer.id).push(`<text id="${escapeXml(element.id)}" x="${point.xMm}" y="${point.yMm}" fill="${layer.color}" font-family="${escapeXml(element.fontFamily)}" font-size="${element.fontSizeMm}"${transform}>${escapeXml(element.text)}</text>`);
      continue;
    }
    const xMm = point.flipX ? point.xMm - element.widthMm : point.xMm;
    const yMm = point.flipY ? point.yMm - element.heightMm : point.yMm;
    if (element.type === "line") {
      const endPoint = mapDocumentPoint(document, element.xMm + element.widthMm, element.yMm + element.heightMm);
      const transform = transformAttribute(element, (point.xMm + endPoint.xMm) / 2, (point.yMm + endPoint.yMm) / 2);
      nodesByLayer.get(layer.id).push(`<line id="${escapeXml(element.id)}" x1="${point.xMm}" y1="${point.yMm}" x2="${endPoint.xMm}" y2="${endPoint.yMm}" fill="none" stroke="${layer.color}"${transform}/>`);
      continue;
    }
    const centerX = xMm + element.widthMm / 2;
    const centerY = yMm + element.heightMm / 2;
    const transform = transformAttribute(element, centerX, centerY);
    if (element.type === "ellipse") {
      nodesByLayer.get(layer.id).push(`<ellipse id="${escapeXml(element.id)}" cx="${centerX}" cy="${centerY}" rx="${element.widthMm / 2}" ry="${element.heightMm / 2}" fill="${fill}" stroke="${layer.color}"${transform}/>`);
      continue;
    }
    if (element.type === "path") {
      const sourcePath = new SVGPathData(element.pathData);
      const bounds = sourcePath.getBounds();
      const sourceWidth = bounds.maxX - bounds.minX;
      const sourceHeight = bounds.maxY - bounds.minY;
      const path = new SVGPathData(element.pathData)
        .translate(-bounds.minX, -bounds.minY)
        .scale(sourceWidth ? element.widthMm / sourceWidth : 1, sourceHeight ? element.heightMm / sourceHeight : 1)
        .scale(point.flipX ? -1 : 1, point.flipY ? -1 : 1)
        .translate(point.flipX ? document.widthMm - element.xMm : element.xMm,
          point.flipY ? document.heightMm - element.yMm : element.yMm);
      const pathTransform = transformAttribute(element, point.xMm - (point.flipX ? element.widthMm / 2 : -element.widthMm / 2),
        point.yMm - (point.flipY ? element.heightMm / 2 : -element.heightMm / 2));
      const power = element.powerPercent === undefined ? "" : ` data-power-percent="${element.powerPercent}"`;
      nodesByLayer.get(layer.id).push(`<path id="${escapeXml(element.id)}" d="${escapeXml(path.encode())}" fill="${fill}" stroke="${layer.color}"${power}${pathTransform}/>`);
      continue;
    }
    if (element.type === "image") {
      nodesByLayer.get(layer.id).push(`<image id="${escapeXml(element.id)}" x="${xMm}" y="${yMm}" width="${element.widthMm}" height="${element.heightMm}" href="${escapeXml(element.imageDataUri)}" preserveAspectRatio="${element.preserveAspectRatio}"${transform}/>`);
      continue;
    }
    if (element.type === "svg-image") {
      nodesByLayer.get(layer.id).push(`<image id="${escapeXml(element.id)}" x="${xMm}" y="${yMm}" width="${element.widthMm}" height="${element.heightMm}" href="${escapeXml(element.svgDataUri)}" preserveAspectRatio="xMidYMid meet"${transform}/>`);
      continue;
    }
    nodesByLayer.get(layer.id).push(`<rect id="${escapeXml(element.id)}" x="${xMm}" y="${yMm}" width="${element.widthMm}" height="${element.heightMm}" fill="${fill}" stroke="${layer.color}"${transform}/>`);
  }
  const layerGroups = document.layers.map((layer) =>
    `<g data-layer-id="${escapeXml(layer.id)}" data-layer-name="${escapeXml(layer.name)}" data-operation="${layer.operation}" data-color="${layer.color}" data-feed-mm-per-minute="${layer.feedMmPerMinute}" data-power-percent="${layer.powerPercent}" data-passes="${layer.passes}" data-fill-spacing-mm="${layer.fillSpacingMm}" data-fill-algorithm="${layer.fillAlgorithm}" data-object-order="${layer.objectOrder}" data-enabled="${layer.enabled}" data-visible="${layer.visible}" data-locked="${layer.locked}">${nodesByLayer.get(layer.id).join("\n")}</g>`
  );

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" data-commburn-version="1" width="${document.widthMm}mm" height="${document.heightMm}mm" viewBox="0 0 ${document.widthMm} ${document.heightMm}">`,
    `<g fill="#172033" stroke-linecap="round" stroke-linejoin="round">`,
    ...layerGroups,
    `</g>`,
    `</svg>`,
    ``
  ].join("\n");
}

function distanceBetween(start, end) {
  return Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm);
}

function mapPoints(document, points) {
  return points.map(([xMm, yMm]) => mapDocumentPoint(document, xMm, yMm));
}

function flattenVectorPath(element) {
  const source = new SVGPathData(element.pathData);
  const bounds = source.getBounds();
  const scaleX = bounds.maxX === bounds.minX ? 1 : element.widthMm / (bounds.maxX - bounds.minX);
  const scaleY = bounds.maxY === bounds.minY ? 1 : element.heightMm / (bounds.maxY - bounds.minY);
  const commands = source.toAbs().normalizeHVZ().normalizeST().qtToC().aToC().commands;
  const paths = [];
  let points = null;
  let current = null;
  let subpathStart = null;
  const toDocumentPoint = ([x, y]) => [
    element.xMm + (x - bounds.minX) * scaleX,
    element.yMm + (y - bounds.minY) * scaleY
  ];
  for (const command of commands) {
    if (command.type === SVGPathData.MOVE_TO) {
      if (points?.length > 1) paths.push(points);
      current = [command.x, command.y];
      subpathStart = current;
      points = [toDocumentPoint(current)];
    } else if (command.type === SVGPathData.LINE_TO) {
      if (!points) throw new RangeError(`Path ${element.id} must start with a move command`);
      current = [command.x, command.y];
      points.push(toDocumentPoint(current));
    } else if (command.type === SVGPathData.CURVE_TO) {
      if (!points || !current) throw new RangeError(`Path ${element.id} must start with a move command`);
      const control1 = [command.x1, command.y1];
      const control2 = [command.x2, command.y2];
      const end = [command.x, command.y];
      const length = distanceBetween(
        { xMm: current[0], yMm: current[1] },
        { xMm: control1[0], yMm: control1[1] }
      ) + distanceBetween(
        { xMm: control1[0], yMm: control1[1] },
        { xMm: control2[0], yMm: control2[1] }
      ) + distanceBetween(
        { xMm: control2[0], yMm: control2[1] },
        { xMm: end[0], yMm: end[1] }
      );
      const steps = Math.max(4, Math.min(200, Math.ceil(length * Math.max(scaleX, scaleY) / 0.25)));
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const oneMinusT = 1 - t;
        const point = [0, 1].map((axis) =>
          oneMinusT ** 3 * current[axis]
          + 3 * oneMinusT ** 2 * t * control1[axis]
          + 3 * oneMinusT * t ** 2 * control2[axis]
          + t ** 3 * end[axis]
        );
        points.push(toDocumentPoint(point));
      }
      current = end;
    } else if (command.type === SVGPathData.CLOSE_PATH) {
      if (points?.length > 1 && (current[0] !== subpathStart[0] || current[1] !== subpathStart[1])) {
        points.push(toDocumentPoint(subpathStart));
      }
      if (points?.length > 1) paths.push(points);
      points = null;
      current = null;
      subpathStart = null;
    } else {
      throw new RangeError(`Path ${element.id} has unsupported geometry for GRBL output`);
    }
  }
  if (points?.length > 1) paths.push(points);
  if (paths.flat().length > 100000) throw new RangeError(`Path ${element.id} creates too many GRBL segments`);
  return paths;
}

function fillPaths(element, algorithm, spacingMm) {
  const horizontal = [];
  const vertical = [];
  const rowCount = Math.floor(element.heightMm / spacingMm) + 1;
  const columnCount = Math.floor(element.widthMm / spacingMm) + 1;
  const usesHorizontal = ["horizontal-serpentine", "horizontal-unidirectional", "crosshatch"].includes(algorithm);
  const usesVertical = ["vertical-serpentine", "crosshatch"].includes(algorithm);
  if ((usesHorizontal && rowCount > 50000) || (usesVertical && columnCount > 50000)
    || ((usesHorizontal ? rowCount : 0) + (usesVertical ? columnCount : 0)) > 50000) {
    throw new RangeError(`Fill spacing creates too many scan lines for element ${element.id}`);
  }
  if (usesHorizontal) {
    for (let row = 0; row < rowCount; row += 1) {
      const yMm = Math.min(element.yMm + row * spacingMm, element.yMm + element.heightMm);
      const reverse = algorithm !== "horizontal-unidirectional" && row % 2 === 1;
      horizontal.push(reverse
        ? [[element.xMm + element.widthMm, yMm], [element.xMm, yMm]]
        : [[element.xMm, yMm], [element.xMm + element.widthMm, yMm]]);
    }
  }
  if (usesVertical) {
    for (let column = 0; column < columnCount; column += 1) {
      const xMm = Math.min(element.xMm + column * spacingMm, element.xMm + element.widthMm);
      const reverse = column % 2 === 1;
      vertical.push(reverse
        ? [[xMm, element.yMm + element.heightMm], [xMm, element.yMm]]
        : [[xMm, element.yMm], [xMm, element.yMm + element.heightMm]]);
    }
  }
  return [...horizontal, ...vertical];
}

function createElementWorkPaths(document, layer, element) {
  const outline = [
    [element.xMm, element.yMm],
    [element.xMm + element.widthMm, element.yMm],
    [element.xMm + element.widthMm, element.yMm + element.heightMm],
    [element.xMm, element.yMm + element.heightMm],
    [element.xMm, element.yMm]
  ];
  if (layer.operation === "fill" && element.type !== "rect") {
    throw new RangeError(`GRBL fill currently supports rectangles only; path ${element.id} must use engrave or cut`);
  }
  const sourcePaths = layer.operation === "fill"
    ? fillPaths(element, layer.fillAlgorithm, layer.fillSpacingMm)
    : element.type === "path"
      ? flattenVectorPath(element)
      : [outline];
  if (sourcePaths.length * layer.passes > 100000) {
    throw new RangeError(`Layer ${layer.name} creates too many tool paths`);
  }
  const workPaths = [];
  for (let pass = 1; pass <= layer.passes; pass += 1) {
    for (const points of sourcePaths) {
      workPaths.push({
        kind: "work",
        elementId: element.id,
        layerId: layer.id,
        operation: layer.operation,
        algorithm: layer.operation === "fill" ? layer.fillAlgorithm : "outline",
        pass,
        ...(element.powerPercent === undefined ? {} : { powerPercent: element.powerPercent }),
        points: mapPoints(document, points)
      });
    }
  }
  return workPaths;
}

function orderLayerElements(document, layer, elements, workByElement, startPoint) {
  if (layer.objectOrder === "document") return elements;
  const distanceFromCenter = (element) => {
    const centerX = element.xMm + element.widthMm / 2;
    const centerY = element.yMm + element.heightMm / 2;
    return Math.hypot(centerX - document.widthMm / 2, centerY - document.heightMm / 2);
  };
  if (layer.objectOrder === "center-out") {
    return [...elements].sort((a, b) => distanceFromCenter(a) - distanceFromCenter(b));
  }
  if (elements.length > 2000) {
    throw new RangeError(`Layer ${layer.name} has too many objects for nearest-neighbor ordering; use document order or center-out`);
  }

  const remaining = [...elements];
  const ordered = [];
  let current = startPoint ?? mapDocumentPoint(document, 0, 0);
  while (remaining.length > 0) {
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const firstPoint = workByElement.get(remaining[index].id)[0].points[0];
      const distance = distanceBetween(current, firstPoint);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    const [next] = remaining.splice(nearestIndex, 1);
    ordered.push(next);
    current = workByElement.get(next.id).at(-1).points.at(-1);
  }
  return ordered;
}

export function planGrblJob(input, settings) {
  const document = createDocument(input);
  const feedOverride = settings.feedMmPerMinute === undefined
    ? null
    : positiveNumber(settings.feedMmPerMinute, "feedMmPerMinute");
  const maxSpindleSpeed = positiveNumber(settings.maxSpindleSpeed, "maxSpindleSpeed");
  const powerOverride = settings.powerPercent;
  if (powerOverride !== undefined && (typeof powerOverride !== "number" || !Number.isFinite(powerOverride) || powerOverride <= 0 || powerOverride > 100)) {
    throw new RangeError("powerPercent must be greater than zero and at most 100");
  }
  const activeLayers = document.layers.filter((layer) => layer.enabled);
  const activeLayerIds = new Set(activeLayers.map((layer) => layer.id));
  const elements = document.elements.filter((element) => activeLayerIds.has(element.layerId));
  if (elements.length === 0) throw new RangeError("The job has no objects in enabled layers");
  if (elements.some((element) => !["rect", "path"].includes(element.type))) {
    throw new RangeError("GRBL supports rectangles and editable vector paths only; convert images to paths and outline text before export");
  }
  if (elements.some((element) => element.rotationDeg !== 0 || element.skewXDeg !== 0 || element.skewYDeg !== 0)) {
    throw new RangeError("GRBL output currently supports untransformed rectangles only");
  }

  const gcode = ["G21", "G90", "G94", "M5"];
  const paths = [];
  let previousPoint = null;
  let travelDistanceMm = 0;
  let workDistanceMm = 0;
  for (const layer of activeLayers) {
    const layerElements = elements.filter((element) => element.layerId === layer.id);
    if (layerElements.length === 0) continue;
    const feedMmPerMinute = feedOverride ?? layer.feedMmPerMinute;
    const powerPercent = powerOverride ?? layer.powerPercent;
    const power = Math.round(maxSpindleSpeed * powerPercent / 100);
    for (const element of layerElements) {
      const corners = mapPoints(document, [
        [element.xMm, element.yMm],
        [element.xMm + element.widthMm, element.yMm],
        [element.xMm + element.widthMm, element.yMm + element.heightMm],
        [element.xMm, element.yMm + element.heightMm]
      ]);
      for (const point of corners) {
        if (point.xMm < 0 || point.xMm > document.widthMm || point.yMm < 0 || point.yMm > document.heightMm) {
          throw new RangeError(`Element ${element.id} extends outside the document work area`);
        }
      }
    }
    const workByElement = new Map(layerElements.map((element) => [
      element.id,
      createElementWorkPaths(document, layer, element)
    ]));
    const orderedElements = orderLayerElements(document, layer, layerElements, workByElement, previousPoint);
    for (const element of orderedElements) {
      for (const workPath of workByElement.get(element.id)) {
        if (paths.length >= 100000) throw new RangeError("The job creates too many tool paths and rapid moves");
        const start = workPath.points[0];
        if (previousPoint) {
          const travelMm = distanceBetween(previousPoint, start);
          if (travelMm > 0) {
            if (paths.length >= 100000) throw new RangeError("The job creates too many tool paths and rapid moves");
            paths.push({
              kind: "travel",
              elementId: element.id,
              layerId: layer.id,
              points: [previousPoint, start]
            });
            travelDistanceMm += travelMm;
          }
        }
        gcode.push("M5");
        gcode.push(`G0 X${start.xMm} Y${start.yMm}`);
        const pathPower = workPath.powerPercent ?? powerPercent;
        gcode.push(`M4 S${Math.round(maxSpindleSpeed * pathPower / 100)}`);
        gcode.push(`G1 F${feedMmPerMinute}`);
        for (const point of workPath.points.slice(1)) {
          gcode.push(`G1 X${point.xMm} Y${point.yMm}`);
        }
        paths.push(workPath);
        for (let index = 1; index < workPath.points.length; index += 1) {
          workDistanceMm += distanceBetween(workPath.points[index - 1], workPath.points[index]);
        }
        previousPoint = workPath.points.at(-1);
        if (layer.operation !== "fill") gcode.push("M5");
      }
    }
  }
  gcode.push("M5");
  return {
    gcode: `${gcode.join("\n")}\n`,
    paths,
    stats: {
      workPathCount: paths.filter((path) => path.kind === "work").length,
      rapidMoveCount: paths.filter((path) => path.kind === "travel").length,
      workDistanceMm,
      travelDistanceMm
    }
  };
}

export function renderGrblJob(input, settings) {
  return planGrblJob(input, settings).gcode;
}
