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
  if (bytes.length > 10 * 1024 * 1024) throw new RangeError(`Element ${id} imageDataUri exceeds 10 MB`);
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
    return { id, type: "path", xMm, yMm, widthMm, heightMm, pathData: element.pathData, layerId, ...transforms };
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
      nodesByLayer.get(layer.id).push(`<path id="${escapeXml(element.id)}" d="${escapeXml(path.encode())}" fill="${fill}" stroke="${layer.color}"${pathTransform}/>`);
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
    `<g data-layer-id="${escapeXml(layer.id)}" data-layer-name="${escapeXml(layer.name)}" data-operation="${layer.operation}" data-color="${layer.color}" data-feed-mm-per-minute="${layer.feedMmPerMinute}" data-power-percent="${layer.powerPercent}" data-passes="${layer.passes}" data-fill-spacing-mm="${layer.fillSpacingMm}" data-enabled="${layer.enabled}" data-visible="${layer.visible}" data-locked="${layer.locked}">${nodesByLayer.get(layer.id).join("\n")}</g>`
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

export function renderGrblJob(input, settings) {
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
  if (elements.some((element) => element.type !== "rect")) {
    throw new RangeError("GRBL output currently supports rectangles only; text must be converted to paths first");
  }
  if (elements.some((element) => element.rotationDeg !== 0 || element.skewXDeg !== 0 || element.skewYDeg !== 0)) {
    throw new RangeError("GRBL output currently supports untransformed rectangles only");
  }

  const gcode = ["G21", "G90", "G94", "M5"];
  for (const layer of activeLayers) {
    const layerElements = elements.filter((element) => element.layerId === layer.id);
    if (layerElements.length === 0) continue;
    const feedMmPerMinute = feedOverride ?? layer.feedMmPerMinute;
    const powerPercent = powerOverride ?? layer.powerPercent;
    const power = Math.round(maxSpindleSpeed * powerPercent / 100);
    for (const element of layerElements) {
      const corners = [
        [element.xMm, element.yMm],
        [element.xMm + element.widthMm, element.yMm],
        [element.xMm + element.widthMm, element.yMm + element.heightMm],
        [element.xMm, element.yMm + element.heightMm]
      ].map(([xMm, yMm]) => mapDocumentPoint(document, xMm, yMm));
      for (const point of corners) {
        if (point.xMm < 0 || point.xMm > document.widthMm || point.yMm < 0 || point.yMm > document.heightMm) {
          throw new RangeError(`Element ${element.id} extends outside the document work area`);
        }
      }
      if (layer.operation === "fill") {
        const rows = Math.floor(element.heightMm / layer.fillSpacingMm) + 1;
        if (rows > 50000) throw new RangeError(`Layer ${layer.name} fill spacing creates too many scan lines`);
        for (let pass = 0; pass < layer.passes; pass += 1) {
          for (let row = 0; row < rows; row += 1) {
            const yMm = Math.min(element.yMm + row * layer.fillSpacingMm, element.yMm + element.heightMm);
            const startX = row % 2 === 0 ? element.xMm : element.xMm + element.widthMm;
            const endX = row % 2 === 0 ? element.xMm + element.widthMm : element.xMm;
            const start = mapDocumentPoint(document, startX, yMm);
            const end = mapDocumentPoint(document, endX, yMm);
            gcode.push("M5");
            gcode.push(`G0 X${start.xMm} Y${start.yMm}`);
            gcode.push(`M4 S${power}`);
            gcode.push(`G1 F${feedMmPerMinute}`);
            gcode.push(`G1 X${end.xMm} Y${end.yMm}`);
          }
        }
      } else {
        for (let pass = 0; pass < layer.passes; pass += 1) {
          gcode.push("M5");
          gcode.push(`G0 X${corners[0].xMm} Y${corners[0].yMm}`);
          gcode.push(`M4 S${power}`);
          gcode.push(`G1 F${feedMmPerMinute}`);
          for (const point of corners.slice(1)) gcode.push(`G1 X${point.xMm} Y${point.yMm}`);
          gcode.push(`G1 X${corners[0].xMm} Y${corners[0].yMm}`);
          gcode.push("M5");
        }
      }
    }
  }
  gcode.push("M5");
  return `${gcode.join("\n")}\n`;
}
