import { DEFAULT_LAYER, normalizeLayers } from "./layers.js";
import { CommBurnRangeError, CommBurnTypeError } from "./i18n.js";
import { createTextOutlinePathData, getTextFontAsset, getTextSvgFamily } from "./text-to-path.js";
import { SVGPathData } from "../../node_modules/svg-pathdata/lib/SVGPathData.module.js";

const ORIGIN_CORNERS = new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CommBurnTypeError("document.invalidNumber", { label }, { message: `${label} must be a finite number of millimetres` });
  }
  return value;
}

function positiveNumber(value, label) {

  const number = finiteNumber(value, label);

  if (number <= 0) throw new CommBurnRangeError("document.positiveNumber", { label }, { message: `${label} must be greater than zero` });
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
  if (!ORIGIN_CORNERS.has(corner)) throw new CommBurnRangeError("document.invalidOrigin", { corner }, { message: `Unsupported origin corner: ${corner}` });
  const flipX = origin.flipX ?? false;
  const flipY = origin.flipY ?? false;
  if (typeof flipX !== "boolean" || typeof flipY !== "boolean") {
    throw new CommBurnTypeError("document.invalidAxes", {}, { message: "Axis inversion settings must be boolean" });
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
    const color = element.color;
    if (color !== undefined && (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))) {
      throw new RangeError(`Element ${id} color must be a six-digit hexadecimal color`);
    }
    const fillColorMode = element.fillColorMode;
    if (fillColorMode !== undefined && !["image", "layer", "none"].includes(fillColorMode)) {
      throw new RangeError(`Element ${id} has an unsupported fillColorMode`);
    }
    const strokeColorMode = element.strokeColorMode;
    if (strokeColorMode !== undefined && !["image", "layer", "none"].includes(strokeColorMode)) {
      throw new RangeError(`Element ${id} has an unsupported strokeColorMode`);
    }
    const strokeWidthMm = element.strokeWidthMm;
    if (strokeWidthMm !== undefined && (typeof strokeWidthMm !== "number" || !Number.isFinite(strokeWidthMm) || strokeWidthMm < 0)) {
      throw new RangeError(`Element ${id} strokeWidthMm must be a finite non-negative millimetre value`);
    }
    return {
      id, type: "path", xMm, yMm, widthMm, heightMm, pathData: element.pathData, layerId,
      ...(powerPercent === undefined ? {} : { powerPercent }),
      ...(color === undefined ? {} : { color: color.toLowerCase() }),
      ...(fillColorMode === undefined ? {} : { fillColorMode }),
      ...(strokeColorMode === undefined ? {} : { strokeColorMode }),
      ...(strokeWidthMm === undefined ? {} : { strokeWidthMm }),
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
  if (!Array.isArray(elements)) throw new CommBurnTypeError("document.invalidElements", {}, { message: "elements must be an array" });
  const layers = normalizeLayers(input.layers ?? [DEFAULT_LAYER]);
  const layerIds = new Set(layers.map((layer) => layer.id));
  const normalizedElements = elements.map((element, index) => normalizeElement(element, index, layers[0].id));
  const ids = new Set();
  for (const element of normalizedElements) {
    if (!element.id.trim()) throw new CommBurnRangeError("document.emptyId", {}, { message: "Object ids must not be empty" });
    if (ids.has(element.id)) throw new CommBurnRangeError("document.duplicateId", { id: element.id }, { message: `Duplicate object id: ${element.id}` });
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

// One visual language for every vector object, driven only by the layer operation:
// fill = solid, engrave = solid outline, cut = dashed outline. The object itself never changes.
function operationLook(layer, widthMm = 0.2) {
  if (layer.operation === "fill") return `fill="${layer.color}" stroke="none"`;
  const dash = layer.operation === "cut"
    ? ` stroke-dasharray="${Math.max(2, widthMm * 3)} ${Math.max(1, widthMm * 1.5)}"`
    : "";
  return `fill="none" stroke="${layer.color}" stroke-width="${widthMm}"${dash}`;
}

export function renderSvg(input, { embedFonts = true } = {}) {
  const document = createDocument(input);
  const nodesByLayer = new Map(document.layers.map((layer) => [layer.id, []]));
  const textFamilies = new Set(document.elements
    .filter((element) => element.type === "text")
    .map((element) => element.fontFamily ?? "sans-serif"));
  const fontStyle = embedFonts && textFamilies.size > 0
    ? `<style>${[...textFamilies].map((family) => {
      const asset = getTextFontAsset(family);
      if (!asset) return "";
      const { family: svgFamily, bytes } = asset;
      const base64 = btoa(Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join(""));
      return `@font-face{font-family:"${svgFamily}";src:url(data:font/woff;base64,${base64}) format("woff");font-style:normal;font-weight:400}`;
    }).join("")}</style>`
    : "";
  for (const element of document.elements) {
    const layer = document.layers.find((candidate) => candidate.id === element.layerId);
    if (!layer.visible) continue;
    const point = mapDocumentPoint(document, element.xMm, element.yMm);
    const fill = layer.operation === "fill" ? layer.color : "none";
    if (element.type === "text") {
      const svgFamily = getTextSvgFamily(element.fontFamily);
      const transform = transformAttribute(element, point.xMm, point.yMm);
      const lines = element.text.normalize("NFC").replace(/\r\n?/g, "\n").replaceAll("\t", "    ").split("\n");
      const lineHeight = element.fontSizeMm * 1.2;
      const spans = lines.map((line, index) => `<tspan x="${point.xMm}" y="${point.yMm + index * lineHeight}">${escapeXml(line)}</tspan>`).join("");
      nodesByLayer.get(layer.id).push(`<text id="${escapeXml(element.id)}" font-family="${escapeXml(svgFamily)}" font-size="${element.fontSizeMm}" font-kerning="none" font-variant-ligatures="none" xml:space="preserve" ${operationLook(layer)}${transform}>${spans}</text>`);
      continue;
    }
    const xMm = point.flipX ? point.xMm - element.widthMm : point.xMm;
    const yMm = point.flipY ? point.yMm - element.heightMm : point.yMm;
    if (element.type === "line") {
      const endPoint = mapDocumentPoint(document, element.xMm + element.widthMm, element.yMm + element.heightMm);
      const transform = transformAttribute(element, (point.xMm + endPoint.xMm) / 2, (point.yMm + endPoint.yMm) / 2);
      nodesByLayer.get(layer.id).push(`<line id="${escapeXml(element.id)}" x1="${point.xMm}" y1="${point.yMm}" x2="${endPoint.xMm}" y2="${endPoint.yMm}" ${operationLook({ ...layer, operation: layer.operation === "fill" ? "engrave" : layer.operation })}${transform}/>`);
      continue;
    }
    const centerX = xMm + element.widthMm / 2;
    const centerY = yMm + element.heightMm / 2;
    const transform = transformAttribute(element, centerX, centerY);
    if (element.type === "ellipse") {
      nodesByLayer.get(layer.id).push(`<ellipse id="${escapeXml(element.id)}" cx="${centerX}" cy="${centerY}" rx="${element.widthMm / 2}" ry="${element.heightMm / 2}" ${operationLook(layer)}${transform}/>`);
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
      const layerColored = element.fillColorMode === "layer" || element.strokeColorMode === "layer";
      const machineFaithful = element.fillColorMode !== "image" && element.strokeColorMode !== "image"
        && (layerColored || element.color === undefined);
      if (machineFaithful) {
        const noModes = element.fillColorMode === undefined && element.strokeColorMode === undefined;
        const fillIntent = noModes || element.fillColorMode === "layer";
        const strokeIntent = !noModes && element.strokeColorMode === "layer";
        const isFill = layer.operation === "fill";
        const fillOn = fillIntent && isFill;
        const strokeOn = noModes ? !isFill : strokeIntent ? !(fillIntent && isFill) : fillIntent && !isFill;
        const width = 0.2;
        const look = strokeOn
          ? operationLook({ ...layer, operation: isFill ? "engrave" : layer.operation }, width)
          : `fill="${fillOn ? layer.color : "none"}" stroke="none"`;
        const paint = strokeOn && fillOn ? look.replace('fill="none"', `fill="${layer.color}"`) : look;
        nodesByLayer.get(layer.id).push(`<path id="${escapeXml(element.id)}" d="${escapeXml(path.encode())}" ${paint}${power}${pathTransform}/>`);
        continue;
      }
      const pathFill = element.fillColorMode === "none"
        ? "none"
        : element.fillColorMode === "layer"
          ? fill
          : element.color ?? fill;
      const pathStroke = element.strokeColorMode === "none"
        ? "none"
        : element.strokeColorMode === "image"
          ? element.color ?? layer.color
          : element.strokeColorMode === "layer"
            ? layer.color
            : element.color ? "none" : layer.color;
      const strokeWidth = element.strokeWidthMm === undefined ? "" : ` stroke-width="${element.strokeWidthMm}"`;
      nodesByLayer.get(layer.id).push(`<path id="${escapeXml(element.id)}" d="${escapeXml(path.encode())}" fill="${pathFill}" stroke="${pathStroke}"${strokeWidth}${power}${pathTransform}/>`);
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
    nodesByLayer.get(layer.id).push(`<rect id="${escapeXml(element.id)}" x="${xMm}" y="${yMm}" width="${element.widthMm}" height="${element.heightMm}" ${operationLook(layer)}${transform}/>`);
  }
  const layerGroups = document.layers.map((layer) =>
    `<g data-layer-id="${escapeXml(layer.id)}" data-layer-name="${escapeXml(layer.name)}" data-operation="${layer.operation}" data-color="${layer.color}" data-feed-mm-per-minute="${layer.feedMmPerMinute}" data-power-percent="${layer.powerPercent}" data-passes="${layer.passes}" data-fill-spacing-mm="${layer.fillSpacingMm}" data-fill-algorithm="${layer.fillAlgorithm}" data-object-order="${layer.objectOrder}" data-enabled="${layer.enabled}" data-visible="${layer.visible}" data-locked="${layer.locked}">${nodesByLayer.get(layer.id).join("\n")}</g>`
  );

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" data-commburn-version="1" width="${document.widthMm}mm" height="${document.heightMm}mm" viewBox="0 0 ${document.widthMm} ${document.heightMm}">`,
    fontStyle,
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

function mapTextOutlines(document, paths, bounds) {
  const minX = bounds.xMm;
  const maxX = bounds.xMm + bounds.widthMm;
  const minY = bounds.yMm;
  const maxY = bounds.yMm + bounds.heightMm;
  const { flipX, flipY } = mapDocumentPoint(document, 0, 0);
  return paths.map((path) => mapPoints(document, path.map(([x, y]) => [
    flipX ? minX + maxX - x : x,
    flipY ? minY + maxY - y : y
  ])));
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
  if (paths.flat().length > 100000) {
    throw new RangeError(`O caminho ${element.id} excede 100.000 segmentos GRBL; simplifique a geometria antes de gerar a prévia.`);
  }
  return paths;
}

function fillPaths(element, algorithm, spacingMm) {
  const horizontal = [];
  const vertical = [];
  const rowCount = Math.floor(element.heightMm / spacingMm) + 1;
  const columnCount = Math.floor(element.widthMm / spacingMm) + 1;
  const usesHorizontal = ["horizontal-serpentine", "horizontal-unidirectional", "crosshatch"].includes(algorithm);
  const usesVertical = ["vertical-serpentine", "vertical-unidirectional", "crosshatch"].includes(algorithm);
  if ((usesHorizontal && rowCount > 50000) || (usesVertical && columnCount > 50000)
    || ((usesHorizontal ? rowCount : 0) + (usesVertical ? columnCount : 0)) > 50000) {
    throw new RangeError(`O preenchimento de ${element.id} excede 50.000 linhas de varredura; aumente o espaçamento.`);
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
      const reverse = algorithm !== "vertical-unidirectional" && column % 2 === 1;
      vertical.push(reverse
        ? [[xMm, element.yMm + element.heightMm], [xMm, element.yMm]]
        : [[xMm, element.yMm], [xMm, element.yMm + element.heightMm]]);
    }
  }
  return [...horizontal, ...vertical];
}

const DIAGONAL_FILL_ANGLES = Object.freeze({ "diagonal-serpentine": [45], "diagonal-crosshatch": [45, -45] });

// Diagonal fills rotate the shape, scan it horizontally, then rotate the routes back.
function diagonalFillPaths(element, polygons, algorithm, spacingMm) {
  const routes = [];
  for (const degrees of DIAGONAL_FILL_ANGLES[algorithm]) {
    const radians = degrees * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const rotated = polygons.map((points) => points.map(([x, y]) => [x * cos + y * sin, -x * sin + y * cos]));
    const flat = rotated.flat();
    const minX = Math.min(...flat.map((point) => point[0]));
    const minY = Math.min(...flat.map((point) => point[1]));
    const scanned = fillVectorPaths({
      id: element.id,
      xMm: minX,
      yMm: minY,
      widthMm: Math.max(...flat.map((point) => point[0])) - minX,
      heightMm: Math.max(...flat.map((point) => point[1])) - minY
    }, "horizontal-serpentine", spacingMm, rotated);
    for (const route of scanned) routes.push(route.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]));
  }
  return routes;
}

function fillVectorPaths(element, algorithm, spacingMm, polygonsOverride) {
  const polygons = polygonsOverride ?? flattenVectorPath(element);
  if (!polygons.length || polygons.some((points) => points.length < 4
    || points[0][0] !== points.at(-1)[0] || points[0][1] !== points.at(-1)[1])) {
    throw new RangeError(`GRBL fill requires closed vector paths; path ${element.id} is open or degenerate`);
  }
  if (DIAGONAL_FILL_ANGLES[algorithm]) return diagonalFillPaths(element, polygons, algorithm, spacingMm);
  const rowCount = Math.floor(element.heightMm / spacingMm) + 1;
  const columnCount = Math.floor(element.widthMm / spacingMm) + 1;
  const usesHorizontal = ["horizontal-serpentine", "horizontal-unidirectional", "crosshatch"].includes(algorithm);
  const usesVertical = ["vertical-serpentine", "vertical-unidirectional", "crosshatch"].includes(algorithm);
  if ((usesHorizontal && rowCount > 50000) || (usesVertical && columnCount > 50000)
    || ((usesHorizontal ? rowCount : 0) + (usesVertical ? columnCount : 0)) > 50000) {
    throw new RangeError(`O preenchimento de ${element.id} excede 50.000 linhas de varredura; aumente o espaçamento.`);
  }

  const visitScanlines = (fixedAxis, originMm, lengthMm, count, visit) => {
    const varyingAxis = 1 - fixedAxis;
    const starts = Array.from({ length: count }, () => []);
    const stops = Array.from({ length: count + 1 }, () => []);
    const coordinateAt = (index) => Math.min(originMm + index * spacingMm, originMm + lengthMm);
    const firstLineAtOrAbove = (value) => {
      let low = 0;
      let high = count;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (coordinateAt(middle) < value) low = middle + 1;
        else high = middle;
      }
      return low;
    };

    for (const polygon of polygons) {
      for (let index = 1; index < polygon.length; index += 1) {
        const start = polygon[index - 1];
        const end = polygon[index];
        const startFixed = start[fixedAxis];
        const endFixed = end[fixedAxis];
        if (startFixed === endFixed) continue;
        const first = firstLineAtOrAbove(Math.min(startFixed, endFixed));
        const afterLast = firstLineAtOrAbove(Math.max(startFixed, endFixed));
        if (first >= afterLast || first >= count) continue;
        const edge = { start, end, startFixed, endFixed };
        starts[first].push(edge);
        stops[Math.min(afterLast, count)].push(edge);
      }
    }

    const activeEdges = new Set();
    for (let line = 0; line < count; line += 1) {
      for (const edge of stops[line]) activeEdges.delete(edge);
      for (const edge of starts[line]) activeEdges.add(edge);
      const coordinate = coordinateAt(line);
      const intersections = [];
      for (const edge of activeEdges) {
        if ((edge.startFixed <= coordinate && edge.endFixed > coordinate)
          || (edge.endFixed <= coordinate && edge.startFixed > coordinate)) {
          const ratio = (coordinate - edge.startFixed) / (edge.endFixed - edge.startFixed);
          intersections.push(edge.start[varyingAxis] + ratio * (edge.end[varyingAxis] - edge.start[varyingAxis]));
        }
      }
      intersections.sort((left, right) => left - right);
      if (intersections.length % 2 !== 0) {
        throw new RangeError(`Path ${element.id} has invalid fill geometry`);
      }
      const spans = [];
      for (let index = 0; index < intersections.length; index += 2) {
        if (intersections[index + 1] - intersections[index] > 1e-9) {
          spans.push([intersections[index], intersections[index + 1]]);
        }
      }
      visit(line, coordinate, spans);
    }
  };

  const paths = [];
  const appendSpans = (fixedAxis, coordinate, spans, reverse) => {
    if (reverse) spans.reverse();
    for (const [start, end] of spans) {
      paths.push(fixedAxis === 1
        ? reverse ? [[end, coordinate], [start, coordinate]] : [[start, coordinate], [end, coordinate]]
        : reverse ? [[coordinate, end], [coordinate, start]] : [[coordinate, start], [coordinate, end]]);
      if (paths.length > 100000) {
        throw new RangeError(`O preenchimento de ${element.id} excede 100.000 trajetórias; aumente o espaçamento ou simplifique a geometria.`);
      }
    }
  };
  if (usesHorizontal) {
    visitScanlines(1, element.yMm, element.heightMm, rowCount, (row, yMm, spans) => {
      const reverse = algorithm !== "horizontal-unidirectional" && row % 2 === 1;
      appendSpans(1, yMm, spans, reverse);
    });
  }
  if (usesVertical) {
    visitScanlines(0, element.xMm, element.widthMm, columnCount, (column, xMm, spans) => {
      const reverse = algorithm !== "vertical-unidirectional" && column % 2 === 1;
      appendSpans(0, xMm, spans, reverse);
    });
  }
  return paths;
}

// Mirrors the SVG transform (rotate, skewX, skewY around the object centre) in document space,
// before mapping to machine coordinates, so rotation never reverses with the origin or axis inversions.
function transformDocumentPoints(element, points) {
  const { rotationDeg, skewXDeg, skewYDeg } = element;
  if (rotationDeg === 0 && skewXDeg === 0 && skewYDeg === 0) return points;
  const centerX = element.type === "text" ? element.xMm : element.xMm + element.widthMm / 2;
  const centerY = element.type === "text" ? element.yMm : element.yMm + element.heightMm / 2;
  const radians = rotationDeg * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const tanX = Math.tan(skewXDeg * Math.PI / 180);
  const tanY = Math.tan(skewYDeg * Math.PI / 180);
  return points.map(([x, y]) => {
    const x0 = x - centerX;
    const y0 = y - centerY;
    // skewX(a) skewY(b): x' = x + tan(a) y ; y' = tan(b) x' + y
    const sx = x0 + tanX * y0;
    const sy = tanY * sx + y0;
    return [Number((centerX + cos * sx - sin * sy).toFixed(6)), Number((centerY + sin * sx + cos * sy).toFixed(6))];
  });
}

function createElementWorkPaths(document, layer, element) {
  let geometryElement = element;
  if (element.type === "text") {
    const pathData = createTextOutlinePathData(element);
    if (!pathData) return [];
    const bounds = new SVGPathData(pathData).getBounds();
    geometryElement = {
      ...element,
      type: "path",
      pathData,
      xMm: bounds.minX,
      yMm: bounds.minY,
      widthMm: bounds.maxX - bounds.minX,
      heightMm: bounds.maxY - bounds.minY
    };
  }
  const outline = [
    [geometryElement.xMm, geometryElement.yMm],
    [geometryElement.xMm + geometryElement.widthMm, geometryElement.yMm],
    [geometryElement.xMm + geometryElement.widthMm, geometryElement.yMm + geometryElement.heightMm],
    [geometryElement.xMm, geometryElement.yMm + geometryElement.heightMm],
    [geometryElement.xMm, geometryElement.yMm]
  ];
  const sourcePaths = layer.operation === "fill"
    ? geometryElement.type === "rect" && DIAGONAL_FILL_ANGLES[layer.fillAlgorithm]
      ? fillVectorPaths(geometryElement, layer.fillAlgorithm, layer.fillSpacingMm, [outline])
    : geometryElement.type === "rect"
      ? fillPaths(geometryElement, layer.fillAlgorithm, layer.fillSpacingMm)
      : fillVectorPaths(geometryElement, layer.fillAlgorithm, layer.fillSpacingMm)
    : geometryElement.type === "path"
      ? flattenVectorPath(geometryElement)
      : [outline];
  const workPaths = [];
  const mappedTextPaths = element.type === "text" ? mapTextOutlines(document, sourcePaths, geometryElement) : null;
  for (let pass = 1; pass <= layer.passes; pass += 1) {
    for (const [sourceIndex, points] of sourcePaths.entries()) {
      workPaths.push({
        kind: "work",
        elementId: element.id,
        layerId: layer.id,
        operation: layer.operation,
        algorithm: layer.operation === "fill" ? layer.fillAlgorithm : "outline",
        pass,
        ...(element.powerPercent === undefined ? {} : { powerPercent: element.powerPercent }),
        points: mappedTextPaths?.[sourceIndex] ?? mapPoints(document, transformDocumentPoints(element, points))
      });
    }
  }
  return workPaths;
}

function orderLayerElements(document, layer, elements, workByElement, startPoint) {
  if (layer.objectOrder === "document") return elements;
  const distanceFromCenter = (element) => {
    let centerX = element.xMm + element.widthMm / 2;
    let centerY = element.yMm + element.heightMm / 2;
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const { points } of workByElement.get(element.id)) {
        for (const point of points) {
          minX = Math.min(minX, point.xMm);
          maxX = Math.max(maxX, point.xMm);
          minY = Math.min(minY, point.yMm);
          maxY = Math.max(maxY, point.yMm);
        }
      }
      centerX = (minX + maxX) / 2;
      centerY = (minY + maxY) / 2;
    }
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

function paintPartKey(element) {
  return [element.pathData, element.xMm, element.yMm, element.widthMm, element.heightMm].join("|");
}

// A fill part and a stroke part imported from one SVG path share geometry; the layer operation
// decides which one is machined so the same contour is never burned twice.
function withoutShadowedPaintParts(layerElements, layer) {
  const isPart = (element, fillMode, strokeMode) => element.type === "path"
    && element.fillColorMode === fillMode && element.strokeColorMode === strokeMode;
  const keep = (element) => {
    const loser = layer.operation === "fill" ? isPart(element, "none", "layer") : isPart(element, "layer", "none");
    const winner = layer.operation === "fill" ? ["layer", "none"] : ["none", "layer"];
    return !loser || !layerElements.some((other) => other !== element && isPart(other, ...winner)
      && paintPartKey(other) === paintPartKey(element));
  };
  return layerElements.filter(keep);
}

export const START_FROM_MODES = Object.freeze(["absolute", "objects"]);
export const START_ANCHORS = Object.freeze(["top-left", "top-right", "bottom-left", "bottom-right", "center"]);
export const WORK_COORDINATE_SYSTEMS = Object.freeze(["G54", "G55", "G56", "G57", "G58", "G59"]);

// "absolute" keeps machine coordinates from the chosen origin; "objects" makes the job start at the
// chosen anchor of the objects' bounding box, so the head position set by the user becomes X0 Y0.
export function planGrblJob(input, settings) {
  const startFrom = settings.startFrom ?? "absolute";
  if (!START_FROM_MODES.includes(startFrom)) {
    throw new CommBurnRangeError("grbl.invalidStartFrom", { startFrom }, { message: `Unsupported start mode: ${startFrom}` });
  }
  const anchor = settings.startAnchor ?? "top-left";
  if (!START_ANCHORS.includes(anchor)) {
    throw new CommBurnRangeError("grbl.invalidStartAnchor", { anchor }, { message: `Unsupported start anchor: ${anchor}` });
  }
  const absolute = buildGrblJob(input, settings, { xMm: 0, yMm: 0 });
  if (startFrom === "absolute") return absolute;
  const points = absolute.paths.filter(({ kind }) => kind === "work").flatMap((path) => path.points);
  const xs = points.map((point) => point.xMm);
  const ys = points.map((point) => point.yMm);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const { flipX, flipY } = mapDocumentPoint(createDocument(input), 0, 0);
  const horizontal = anchor.endsWith("left") ? "left" : anchor.endsWith("right") ? "right" : "center";
  const vertical = anchor.startsWith("top") ? "top" : anchor.startsWith("bottom") ? "bottom" : "center";
  const offset = {
    xMm: horizontal === "center" ? (minX + maxX) / 2 : (horizontal === "left") !== flipX ? minX : maxX,
    yMm: vertical === "center" ? (minY + maxY) / 2 : (vertical === "top") !== flipY ? minY : maxY
  };
  return buildGrblJob(input, settings, offset);
}

// Where the job starts, ends and where machine X0 Y0 sits, in document (STAGE) millimetres,
// plus the document direction of +X and +Y, so the editor can draw the same reference the G-code uses.
// Machine-space plan points back in document (STAGE) millimetres, so previews match what the editor shows
// whatever the origin corner, axis inversions or start offset are. G-code itself stays in machine space.
export function planToDocumentSpace(input, plan) {
  const document = createDocument(input);
  const { flipX, flipY } = mapDocumentPoint(document, 0, 0);
  const { xMm: offsetX, yMm: offsetY } = plan.stats.startOffsetMm ?? { xMm: 0, yMm: 0 };
  const toDocument = (point) => ({
    xMm: flipX ? document.widthMm - (point.xMm + offsetX) : point.xMm + offsetX,
    yMm: flipY ? document.heightMm - (point.yMm + offsetY) : point.yMm + offsetY
  });
  return { ...plan, paths: plan.paths.map((path) => ({ ...path, points: path.points.map(toDocument) })) };
}

// Where the job starts, ends and where machine X0 Y0 sits, in document (STAGE) millimetres,
// plus the document direction of +X and +Y, so the editor can draw the same reference the G-code uses.
export function jobReferencePoints(input, settings) {
  const plan = planGrblJob(input, settings);
  const work = planToDocumentSpace(input, plan).paths.filter(({ kind }) => kind === "work");
  if (work.length === 0) return null;
  const document = createDocument(input);
  const { flipX, flipY } = mapDocumentPoint(document, 0, 0);
  const { xMm: offsetX, yMm: offsetY } = plan.stats.startOffsetMm;
  const corners = work.flatMap(({ points }) => points);
  const xs = corners.map(({ xMm }) => xMm);
  const ys = corners.map(({ yMm }) => yMm);
  return {
    bounds: { minXMm: Math.min(...xs), minYMm: Math.min(...ys), maxXMm: Math.max(...xs), maxYMm: Math.max(...ys) },
    origin: {
      xMm: flipX ? document.widthMm - offsetX : offsetX,
      yMm: flipY ? document.heightMm - offsetY : offsetY
    },
    start: work[0].points[0],
    end: work.at(-1).points.at(-1),
    xDirection: flipX ? -1 : 1,
    yDirection: flipY ? -1 : 1
  };
}

function buildGrblJob(input, settings, offset) {
  const document = createDocument(input);
  const shiftNumber = (value, by) => by === 0 ? value : Number((value - by).toFixed(6));
  const shift = (point) => offset.xMm === 0 && offset.yMm === 0
    ? point
    : { ...point, xMm: shiftNumber(point.xMm, offset.xMm), yMm: shiftNumber(point.yMm, offset.yMm) };
  const coordinateSystem = settings.workCoordinateSystem;
  if (coordinateSystem !== undefined && !WORK_COORDINATE_SYSTEMS.includes(coordinateSystem)) {
    throw new CommBurnRangeError("grbl.invalidWorkCoordinateSystem", { coordinateSystem }, { message: `Unsupported work coordinate system: ${coordinateSystem}` });
  }
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
  const elements = document.elements.filter((element) => activeLayerIds.has(element.layerId)
    && (element.type !== "text" || element.text.trim().length > 0));
  if (elements.length === 0) throw new CommBurnRangeError("grbl.noObjects", {}, { message: "The job has no objects in enabled layers" });
  if (elements.some((element) => !["rect", "path", "text"].includes(element.type))) {
    throw new CommBurnRangeError("grbl.unsupportedGeometry", {}, { message: "GRBL supports rectangles, editable vector paths, and editable text in the built-in engraving fonts" });
  }

  const gcode = ["G21", "G90", "G94", "M5"];
  if (coordinateSystem) gcode.splice(1, 0, coordinateSystem);
  const paths = [];
  let previousPoint = null;
  let travelDistanceMm = 0;
  let workDistanceMm = 0;
  const estimatedWorkTimeSecondsByOperation = { engrave: 0, cut: 0, fill: 0 };
  for (const layer of activeLayers) {
    const layerElements = withoutShadowedPaintParts(elements.filter((element) => element.layerId === layer.id), layer);
    if (layerElements.length === 0) continue;
    const feedMmPerMinute = feedOverride ?? layer.feedMmPerMinute;
    const powerPercent = powerOverride ?? layer.powerPercent;
    const power = Math.round(maxSpindleSpeed * powerPercent / 100);
    const workByElement = new Map(layerElements.map((element) => [
      element.id,
      createElementWorkPaths(document, layer, element)
    ]));
    for (const element of layerElements) {
      const points = workByElement.get(element.id).flatMap(({ points: pathPoints }) => pathPoints);
      for (const point of points) {
        if (point.xMm < 0 || point.xMm > document.widthMm || point.yMm < 0 || point.yMm > document.heightMm) {
          throw new CommBurnRangeError("grbl.outsideWorkArea", { id: element.id }, { message: `Element ${element.id} extends outside the document work area` });
        }
      }
    }
    if ([...workByElement.values()].every((workPaths) => workPaths.length === 0)) {
      throw new RangeError(`Layer ${layer.name} has no fillable paths at the selected spacing`);
    }
    const orderedElements = orderLayerElements(document, layer, layerElements, workByElement, previousPoint);
    for (const element of orderedElements) {
      for (const workPath of workByElement.get(element.id)) {
        if (paths.length >= 100000) {
          throw new RangeError("O trabalho excede o limite seguro de 100.000 trajetórias GRBL; reduza objetos/passagens ou aumente o espaçamento do preenchimento.");
        }
        const start = workPath.points[0];
        const shiftedPath = { ...workPath, points: workPath.points.map(shift) };
        if (previousPoint) {
          const travelMm = distanceBetween(previousPoint, start);
          if (travelMm > 0) {
            if (paths.length >= 100000) {
              throw new RangeError("O trabalho excede o limite seguro de 100.000 trajetórias GRBL; reduza objetos/passagens ou aumente o espaçamento do preenchimento.");
            }
            paths.push({
              kind: "travel",
              elementId: element.id,
              layerId: layer.id,
              points: [shift(previousPoint), shift(start)]
            });
            travelDistanceMm += travelMm;
          }
        }
        gcode.push("M5");
        gcode.push(`G0 X${shiftedPath.points[0].xMm} Y${shiftedPath.points[0].yMm}`);
        const pathPower = workPath.powerPercent ?? powerPercent;
        gcode.push(`M4 S${Math.round(maxSpindleSpeed * pathPower / 100)}`);
        gcode.push(`G1 F${feedMmPerMinute}`);
        for (const point of shiftedPath.points.slice(1)) {
          gcode.push(`G1 X${point.xMm} Y${point.yMm}`);
        }
        paths.push(shiftedPath);
        let pathDistanceMm = 0;
        for (let index = 1; index < workPath.points.length; index += 1) {
          const distanceMm = distanceBetween(workPath.points[index - 1], workPath.points[index]);
          workDistanceMm += distanceMm;
          pathDistanceMm += distanceMm;
        }
        estimatedWorkTimeSecondsByOperation[workPath.operation] += pathDistanceMm / feedMmPerMinute * 60;
        previousPoint = workPath.points.at(-1);
        if (workPath.operation !== "fill") gcode.push("M5");
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
      travelDistanceMm,
      startOffsetMm: { xMm: offset.xMm, yMm: offset.yMm },
      estimatedWorkTimeSecondsByOperation
    }
  };
}

export function renderGrblJob(input, settings) {
  return planGrblJob(input, settings).gcode;
}
