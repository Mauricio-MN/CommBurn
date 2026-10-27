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
  rect: new Set(["x", "y", "width", "height", "rx", "ry", "transform"]),
  circle: new Set(["cx", "cy", "r", "transform"]),
  ellipse: new Set(["cx", "cy", "rx", "ry", "transform"]),
  line: new Set(["x1", "y1", "x2", "y2", "transform"]),
  path: new Set(["d", "transform"]),
  polygon: new Set(["points", "transform"]),
  polyline: new Set(["points", "transform"]),
  text: new Set(["x", "y", "font-size", "font-family", "text-anchor", "dominant-baseline", "transform"]),
  image: new Set(["x", "y", "width", "height", "href", "xlink:href", "preserveAspectRatio", "transform"])
};
const ROOT_ATTRIBUTES = new Set(["xmlns", "xmlns:xlink", "width", "height", "viewBox", "version", "preserveAspectRatio", "data-commburn-version", "transform"]);
const LAYER_ATTRIBUTES = new Set([
  "data-layer-id", "data-layer-name", "data-operation", "data-color",
  "data-feed-mm-per-minute", "data-power-percent", "data-passes", "data-fill-spacing-mm",
  "data-enabled", "data-visible", "data-locked"
]);
const BASIC_COLORS = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff",
  yellow: "#ffff00", orange: "#ffa500", purple: "#800080", pink: "#ffc0cb", gray: "#808080",
  grey: "#808080", cyan: "#00ffff", magenta: "#ff00ff", brown: "#a52a2a"
};
const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
const SVG_DOCTYPE_HEADER = /^<!DOCTYPE\s+svg(?:\s+PUBLIC\s+(?:"[^"]*"|'[^']*')\s+(?:"[^"]*"|'[^']*')|\s+SYSTEM\s+(?:"[^"]*"|'[^']*'))?\s*/;

export function validateSvgSource(source) {
  if (typeof source !== "string") fail("source must be text.");
  if (source.length > 10 * 1024 * 1024) fail("the SVG exceeds the 10 MB limit.");
  const declarationMask = (value) => value.replace(
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]|<\?[\s\S]*?\?>/g,
    (match) => " ".repeat(match.length)
  );
  const maskedSource = declarationMask(source);
  const doctypeMatches = [...maskedSource.matchAll(/<!DOCTYPE\b/gi)];
  if (doctypeMatches.length > 1) fail("only one SVG DOCTYPE declaration is supported.");

  let sanitizedSource = source;
  if (doctypeMatches.length === 1) {
    const offset = doctypeMatches[0].index;
    const end = findDoctypeEnd(source, offset);
    const declaration = source.slice(offset, end);
    const header = SVG_DOCTYPE_HEADER.exec(declaration);
    if (!header) fail("only a DOCTYPE for an SVG root with quoted external identifiers is supported.");
    const body = declaration.slice(header[0].length, -1).trim();
    let internalSubset = "";
    if (body) {
      if (!body.startsWith("[") || !body.endsWith("]")) fail("the SVG DOCTYPE is malformed.");
      internalSubset = body.slice(1, -1);
    }
    const entities = parseInternalEntities(internalSubset);
    sanitizedSource = `${source.slice(0, offset)}${source.slice(end)}`;
    sanitizedSource = expandEntityReferences(sanitizedSource, entities);
  }

  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(declarationMask(sanitizedSource))) {
    fail("unexpanded DTD and entity declarations are not supported.");
  }
  return sanitizedSource.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, content) =>
    content.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  );
}

function findDoctypeEnd(source, start) {
  let quote = "";
  let subsetDepth = 0;
  for (let index = start + "<!DOCTYPE".length; index < source.length; index += 1) {
    if (!quote && source.startsWith("<!--", index)) {
      const commentEnd = source.indexOf("-->", index + 4);
      if (commentEnd < 0) fail("the SVG DOCTYPE contains an unterminated comment.");
      index = commentEnd + 2;
      continue;
    }
    const character = source[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === "[") {
      subsetDepth += 1;
    } else if (character === "]") {
      subsetDepth -= 1;
      if (subsetDepth < 0) fail("the SVG DOCTYPE has an unmatched closing bracket.");
    } else if (character === ">" && subsetDepth === 0) {
      return index + 1;
    }
  }
  fail("the SVG DOCTYPE is unterminated.");
}

function parseInternalEntities(subset) {
  const entities = new Map();
  let cursor = 0;
  while (cursor < subset.length) {
    while (/\s/.test(subset[cursor] ?? "")) cursor += 1;
    if (cursor >= subset.length) break;
    if (subset.startsWith("<!--", cursor)) {
      const end = subset.indexOf("-->", cursor + 4);
      if (end < 0) fail("the SVG DOCTYPE contains an unterminated comment.");
      cursor = end + 3;
      continue;
    }
    const entity = /^<!ENTITY\s+([A-Za-z_:][A-Za-z0-9_.:-]*)\s+(?:"([^"]*)"|'([^']*)')\s*>/.exec(subset.slice(cursor));
    if (entity) {
      const [, name, doubleQuotedValue, singleQuotedValue] = entity;
      if (entities.has(name)) fail(`the SVG DOCTYPE declares entity "${name}" more than once.`);
      const value = doubleQuotedValue ?? singleQuotedValue;
      if (/%[A-Za-z_:][A-Za-z0-9_.:-]*;/.test(value)) {
        fail("parameter entity references are not supported.");
      }
      entities.set(name, value);
      cursor += entity[0].length;
      continue;
    }
    const declaration = /^<!([A-Z]+)/.exec(subset.slice(cursor));
    if (declaration && declaration[1] === "ATTLIST") {
      fail("internal ATTLIST default attributes are not supported.");
    }
    if (declaration && ["ELEMENT", "NOTATION"].includes(declaration[1])) {
      cursor = findDeclarationEnd(subset, cursor);
      continue;
    }
    if (/^<!ENTITY\b/.test(subset.slice(cursor))) {
      fail("only internal text entity declarations are supported; external and parameter entities are not loaded.");
    }
    fail("the SVG DOCTYPE contains an unsupported internal declaration.");
  }
  return entities;
}

function findDeclarationEnd(source, start) {
  let quote = "";
  for (let index = start + 2; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  fail("the SVG DOCTYPE contains an unterminated declaration.");
}

function expandEntityReferences(source, entities) {
  let expansionSize = 0;
  const expandValue = (value, ancestors = []) => value.replace(/&([A-Za-z_:][A-Za-z0-9_.:-]*);/g, (reference, name) => {
    if (Object.hasOwn(XML_ENTITIES, name)) return reference;
    if (!entities.has(name)) fail(`the SVG uses undeclared XML entity "&${name};".`);
    if (ancestors.includes(name)) fail(`the SVG contains a recursive XML entity "${name}".`);
    const expanded = expandValue(entities.get(name), [...ancestors, name]);
    expansionSize += expanded.length;
    if (expansionSize > 1_000_000) fail("expanded XML entities exceed the 1 MB safety limit.");
    return expanded;
  });
  return source.replace(
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|&([A-Za-z_:][A-Za-z0-9_.:-]*);/g,
    (reference, name) => {
      if (!name || Object.hasOwn(XML_ENTITIES, name)) return reference;
      if (!entities.has(name)) fail(`the SVG uses undeclared XML entity "&${name};".`);
      return expandValue(entities.get(name), [name]);
    }
  );
}

function fail(message) {
  throw new Error(`SVG import: ${message}`);
}

function decodeXmlEntities(value, label) {
  if (typeof value !== "string") return value;
  let decoded = "";
  let cursor = 0;
  while (cursor < value.length) {
    const ampersand = value.indexOf("&", cursor);
    if (ampersand < 0) {
      decoded += value.slice(cursor);
      break;
    }
    decoded += value.slice(cursor, ampersand);
    const match = /^&(#x[0-9a-f]+|#\d+|[a-z][a-z\d.-]*);/i.exec(value.slice(ampersand));
    if (!match) fail(`${label} contains an invalid XML entity reference.`);
    const reference = match[1];
    if (reference[0] !== "#") {
      if (!Object.hasOwn(XML_ENTITIES, reference)) {
        fail(`${label} uses unsupported named XML entity "&${reference};"; use a numeric character reference.`);
      }
      decoded += XML_ENTITIES[reference];
    } else {
      const codePoint = reference[1].toLowerCase() === "x"
        ? Number.parseInt(reference.slice(2), 16)
        : Number.parseInt(reference.slice(1), 10);
      const validXmlCharacter = codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
        || (codePoint >= 0x20 && codePoint <= 0xd7ff)
        || (codePoint >= 0xe000 && codePoint <= 0xfffd)
        || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
      if (!validXmlCharacter) fail(`${label} contains an invalid XML character reference.`);
      decoded += String.fromCodePoint(codePoint);
    }
    cursor = ampersand + match[0].length;
  }
  return decoded;
}

function decodeAttributes(attributes, label) {
  return Object.fromEntries(Object.entries(attributes ?? {}).map(([name, value]) => [
    name,
    decodeXmlEntities(value, `${label} attribute "${name}"`)
  ]));
}

function validateVisualUrl(value, label, sanitizeNestedSvg) {
  const url = value.trim();
  if (url.startsWith("#")) return;
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i.test(url)) return;
  if (/^data:image\/svg\+xml;base64,[a-z0-9+/]+={0,2}$/i.test(url) && sanitizeNestedSvg) {
    return sanitizeNestedSvg(url);
  }
  fail(`${label} references external or unsupported content; embed the resource or use a local fragment.`);
}

function validateVisualCss(value, label) {
  const uncommented = value.replace(/\/\*[\s\S]*?\*\//g, "");
  const css = uncommented
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\\\r?\n/g, "")
    .replace(/\\(.)/gs, "$1");
  if (/\/\*|\*\//.test(uncommented) || /@import|expression\s*\(|-moz-binding/i.test(css)) {
    fail(`${label} contains unsupported or active CSS.`);
  }
  const urls = [...css.matchAll(/url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)];
  if ((css.match(/url\s*\(/gi) ?? []).length !== urls.length) fail(`${label} contains a malformed CSS URL.`);
  for (const match of urls) validateVisualUrl(match[1] ?? match[2] ?? match[3] ?? "", label);
}

export function sanitizeSvgForVisual(root, svgson, nestingDepth = 0) {
  if (!root || root.name !== "svg" || root.type !== "element") fail("the document must have an <svg> root.");
  if (!svgson?.parseSync || !svgson?.stringify) fail("the SVG parser or serializer is unavailable.");
  if (nestingDepth > 8) fail("nested SVG images exceed the supported nesting limit.");
  const activeElements = new Set([
    "script", "iframe", "object", "embed", "audio", "video", "handler", "listener"
  ]);
  const state = { count: 0, removedActiveContent: false };
  const sanitizeNestedSvg = (dataUri) => {
    const encoded = /^data:image\/svg\+xml;base64,([a-z0-9+/]+={0,2})$/i.exec(dataUri)?.[1];
    if (!encoded) fail("an embedded SVG image has an invalid data URI.");
    let source;
    try {
      const bytes = atob(encoded);
      if (bytes.length > 10 * 1024 * 1024) fail("an embedded SVG image exceeds 10 MB.");
      source = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes, (byte) => byte.charCodeAt(0)));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("SVG import:")) throw error;
      fail("an embedded SVG image contains invalid encoded XML.");
    }
    const nestedTree = svgson.parseSync(validateSvgSource(source));
    const sanitized = sanitizeSvgForVisual(nestedTree, svgson, nestingDepth + 1);
    state.removedActiveContent ||= sanitized.removedActiveContent;
    const bytes = new TextEncoder().encode(sanitized.source);
    if (bytes.length > 10 * 1024 * 1024) fail("a sanitized embedded SVG image exceeds 10 MB.");
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return `data:image/svg+xml;base64,${btoa(binary)}`;
  };
  const sanitizeNode = (node, depth) => {
    state.count += 1;
    if (state.count > 20000 || depth > 64) fail("the SVG exceeds the 20000 element or 64-level nesting limit.");
    if (node.type === "text") {
      return { ...node, value: decodeXmlEntities(node.value, "SVG text") };
    }
    if (node.type !== "element") fail("the SVG contains an unsupported node type.");
    const name = node.name.toLowerCase();
    if (activeElements.has(name)) {
      state.removedActiveContent = true;
      return null;
    }
    const attributes = decodeAttributes(node.attributes, `<${node.name}>`);
    if (depth === 1) {
      if (attributes.xmlns && attributes.xmlns !== SVG_NAMESPACE) fail("the root namespace is not SVG.");
      if (attributes["xmlns:xlink"] && attributes["xmlns:xlink"] !== "http://www.w3.org/1999/xlink") {
        fail("the xlink namespace is invalid.");
      }
      attributes.xmlns ??= SVG_NAMESPACE;
    }
    for (const [attribute, value] of Object.entries(attributes)) {
      if (/^on/i.test(attribute)) {
        delete attributes[attribute];
        state.removedActiveContent = true;
      } else if (["href", "xlink:href", "src"].includes(attribute.toLowerCase())) {
        attributes[attribute] = validateVisualUrl(value, `<${node.name}> ${attribute}`, sanitizeNestedSvg) ?? value;
      } else if (attribute.toLowerCase() === "xml:base") {
        fail("xml:base is not supported because it can redirect resource references.");
      } else {
        validateVisualCss(value, `<${node.name}> ${attribute}`);
      }
    }
    const children = [];
    for (const child of node.children ?? []) {
      const sanitizedChild = sanitizeNode(child, depth + 1);
      if (sanitizedChild) children.push(sanitizedChild);
    }
    if (name === "style") {
      validateVisualCss(children.map((child) => child.value ?? "").join(""), "<style>");
    }
    return { ...node, attributes, children };
  };
  const sanitizedRoot = sanitizeNode(root, 1);
  return {
    source: svgson.stringify(sanitizedRoot),
    removedActiveContent: state.removedActiveContent
  };
}

export function getSvgViewport(root) {
  if (!root || root.name !== "svg" || root.type !== "element") fail("the document must have an <svg> root.");
  const attributes = decodeAttributes(root.attributes, "<svg>");
  const dimensionsOnly = Object.fromEntries(Object.entries(attributes).filter(([name]) => ROOT_ATTRIBUTES.has(name)));
  const viewBox = parseViewBox(dimensionsOnly.viewBox);
  const explicitWidth = dimensionsOnly.width && !dimensionsOnly.width.trim().endsWith("%")
    ? lengthMm(dimensionsOnly.width, "width")
    : undefined;
  const explicitHeight = dimensionsOnly.height && !dimensionsOnly.height.trim().endsWith("%")
    ? lengthMm(dimensionsOnly.height, "height")
    : undefined;
  const fallbackWidth = viewBox ? viewBox.width * UNIT_TO_MM.px : 300 * UNIT_TO_MM.px;
  const fallbackHeight = viewBox ? viewBox.height * UNIT_TO_MM.px : 150 * UNIT_TO_MM.px;
  let widthMm = explicitWidth ?? fallbackWidth;
  let heightMm = explicitHeight ?? fallbackHeight;
  if (viewBox && explicitWidth && !explicitHeight) heightMm = widthMm * viewBox.height / viewBox.width;
  if (viewBox && explicitHeight && !explicitWidth) widthMm = heightMm * viewBox.width / viewBox.height;
  if (![widthMm, heightMm].every((dimension) => Number.isFinite(dimension) && dimension > 0)) {
    fail("the SVG viewport dimensions must be positive finite values.");
  }
  return { widthMm, heightMm };
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

function parseColor(value) {
  if (value === undefined || value === "" || value === "none" || value === "transparent") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized in BASIC_COLORS) return BASIC_COLORS[normalized];
  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(normalized)) return normalized;
  const rgb = /^rgb\(\s*([^)]*)\s*\)$/.exec(normalized);
  if (rgb) {
    const channels = rgb[1].trim().split(/[\s,]+/);
    if (channels.length === 3) {
      const values = channels.map((channel) => {
        const percent = channel.endsWith("%");
        const numeric = Number(percent ? channel.slice(0, -1) : channel);
        const max = percent ? 100 : 255;
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > max) fail("RGB paint values must be between 0 and 255 (or 0% and 100%).");
        return Math.round(percent ? numeric * 2.55 : numeric);
      });
      return `#${values.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  fail(`unsupported paint color "${value}"; use a named basic color, #RGB, #RRGGBB, or rgb().`);
}

function importedLayerId(prefix, index) {
  return `${prefix}-layer-${index}`;
}

function booleanAttribute(value, label, fallback) {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  fail(`${label} must be "true" or "false".`);
}

function layerFromGroup(attributes, index, prefix) {
  const sourceId = attributes["data-layer-id"];
  if (typeof sourceId !== "string" || !sourceId.trim()) fail("CommBurn layer metadata requires a non-empty data-layer-id.");
  const operation = attributes["data-operation"];
  if (!["engrave", "cut", "fill"].includes(operation)) fail(`unsupported CommBurn layer operation "${operation}".`);
  const color = parseColor(attributes["data-color"]);
  if (!color) fail("CommBurn layer metadata requires a visible data-color.");
  return {
    sourceId,
    layer: {
      ...DEFAULT_LAYER,
      id: importedLayerId(prefix, index),
      name: attributes["data-layer-name"] ?? `Camada importada ${sourceId}`,
      operation,
      color,
      feedMmPerMinute: number(attributes["data-feed-mm-per-minute"], "layer feed rate", DEFAULT_LAYER.feedMmPerMinute),
      powerPercent: number(attributes["data-power-percent"], "layer power", DEFAULT_LAYER.powerPercent),
      passes: number(attributes["data-passes"], "layer passes", DEFAULT_LAYER.passes),
      fillSpacingMm: number(attributes["data-fill-spacing-mm"], "layer fill spacing", DEFAULT_LAYER.fillSpacingMm),
      enabled: booleanAttribute(attributes["data-enabled"], "layer enabled", true),
      visible: booleanAttribute(attributes["data-visible"], "layer visible", true),
      locked: booleanAttribute(attributes["data-locked"], "layer locked", false)
    }
  };
}

function fallbackLayerIdForElement(name, attributes, inheritedStyle, inheritedLayerId, layers, colorLayers, fallbackLayer, idPrefix, forceLayerId) {
  if (forceLayerId) return forceLayerId;
  if (name === "image") return inheritedLayerId;
  const fillValue = attributes.fill ?? inheritedStyle.fill;
  const strokeValue = attributes.stroke ?? inheritedStyle.stroke;
  const fill = parseColor(fillValue);
  const stroke = parseColor(strokeValue);
  const isLine = name === "line";
  if (name === "text" && stroke && (!fill || fill !== stroke)) {
    fail("text stroke paint cannot be preserved; convert outlined text to paths before importing.");
  }
  if (isLine && !stroke) return inheritedLayerId;
  if (fill && stroke && fill !== stroke) {
    fail(`different fill and stroke colors on <${name}> cannot be represented by one CommBurn layer.`);
  }
  const color = isLine ? stroke : fill ?? stroke;
  if (!color) return inheritedLayerId;
  const operation = isLine || !fill ? "engrave" : "fill";
  const key = `${operation}:${color}`;
  if (colorLayers.has(key)) return colorLayers.get(key);
  const id = importedLayerId(idPrefix, layers.length);
  const layer = {
    ...fallbackLayer,
    id,
    name: `Importação ${operation === "fill" ? "preenchimento" : "gravação"} ${color}`,
    operation,
    color,
    locked: false
  };
  layers.push(layer);
  colorLayers.set(key, id);
  return id;
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
      fail(`unsupported or malformed SVG transform "${match[1]}".`);
    }
    if (!next.every(Number.isFinite)) fail("text transform values must be finite.");
    result = multiplyTransforms(result, next);
    consumed = transformPattern.lastIndex;
  }
  if (consumed === 0 || value.slice(consumed).replace(/[\s,]+/g, "")) fail("transform syntax is invalid.");
  return result;
}

function mapMatrix(view, transform) {
  return multiplyTransforms(
    [view.scaleX, 0, 0, view.scaleY, view.offsetX - view.originX * view.scaleX, view.offsetY - view.originY * view.scaleY],
    transform
  );
}

function transformPoint(matrix, x, y) {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

function axisAligned(matrix) {
  const scale = Math.max(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3]), 1);
  return Math.abs(matrix[1]) <= scale * 1e-10 && Math.abs(matrix[2]) <= scale * 1e-10;
}

function rectanglePath(x, y, width, height) {
  return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`;
}

function ellipsePath(cx, cy, rx, ry) {
  const control = 0.5522847498307936;
  return [
    `M ${cx + rx} ${cy}`,
    `C ${cx + rx} ${cy + control * ry} ${cx + control * rx} ${cy + ry} ${cx} ${cy + ry}`,
    `C ${cx - control * rx} ${cy + ry} ${cx - rx} ${cy + control * ry} ${cx - rx} ${cy}`,
    `C ${cx - rx} ${cy - control * ry} ${cx - control * rx} ${cy - ry} ${cx} ${cy - ry}`,
    `C ${cx + control * rx} ${cy - ry} ${cx + rx} ${cy - control * ry} ${cx + rx} ${cy} Z`
  ].join(" ");
}

function mapTextTransform(view, transform) {
  const matrix = mapMatrix(view, transform);
  const [a, b, c, d] = matrix;
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
  if (root.attributes["xmlns:xlink"] && root.attributes["xmlns:xlink"] !== "http://www.w3.org/1999/xlink") {
    fail("the xlink namespace is invalid.");
  }
  if (root.attributes["data-commburn-version"] && root.attributes["data-commburn-version"] !== "1") {
    fail(`unsupported CommBurn SVG version "${root.attributes["data-commburn-version"]}".`);
  }
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

function localTransformedPath(pathData, view, transform) {
  if (pathData.length > 1_000_000) fail("path data exceeds the 1000000 character limit.");
  let path;
  try {
    path = new SVGPathData(pathData).toAbs().aToC();
  } catch (error) {
    fail(`invalid path data: ${error.message}`);
  }
  path.matrix(...mapMatrix(view, transform));
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

export function importSvgTree(root, {
  layerId = "layer-engrave",
  idPrefix = "svg",
  fallbackLayer,
  forceLayerId
} = {}) {
  if (!root || root.name !== "svg" || root.type !== "element") fail("the document must have an <svg> root.");
  const rootAttributes = decodeAttributes(root.attributes, "<svg>");
  const decodedRoot = { ...root, attributes: rootAttributes };
  const view = viewport(decodedRoot);
  const defaultLayer = { ...DEFAULT_LAYER, ...fallbackLayer, id: layerId, locked: false };
  const layers = [defaultLayer];
  const sourceLayers = new Map();
  const colorLayers = new Map();
  const elements = [];
  const rootStyle = { fill: rootAttributes.fill, stroke: rootAttributes.stroke };
  const rootTransform = parseTransform(rootAttributes.transform);
  const stack = root.children.map((node) => ({
    node, depth: 1, layerId, commBurnLayer: false, style: rootStyle,
    transform: rootTransform, ignoredMetadata: false
  })).reverse();
  let count = 0;

  while (stack.length) {
    const { node, depth, layerId: inheritedLayerId, commBurnLayer, style, transform: inheritedTransform, ignoredMetadata } = stack.pop();
    if (node.type === "text") {
      if (!ignoredMetadata && decodeXmlEntities(node.value, "SVG text").trim()) {
        fail("text must be inside a supported <text> element.");
      }
      continue;
    }
    count += 1;
    if (count > 20000 || depth > 64) fail("the SVG exceeds the 20000 element or 64-level nesting limit.");
    if (ignoredMetadata) {
      stack.push(...(node.children ?? []).map((child) => ({
        node: child,
        depth: depth + 1,
        layerId: inheritedLayerId,
        commBurnLayer,
        style,
        transform: inheritedTransform,
        ignoredMetadata: true
      })).reverse());
      continue;
    }
    if (["metadata", "title", "desc"].includes(node.name.toLowerCase())) {
      stack.push(...(node.children ?? []).map((child) => ({
        node: child,
        depth: depth + 1,
        layerId: inheritedLayerId,
        commBurnLayer,
        style,
        transform: inheritedTransform,
        ignoredMetadata: true
      })).reverse());
      continue;
    }
    const a = decodeAttributes(node.attributes, `<${node.name}>`);
    if (node.name === "g") {
      checkedAttributes(node, new Set(["id", "transform", ...LAYER_ATTRIBUTES]), "group");
      const childTransform = multiplyTransforms(inheritedTransform, parseTransform(a.transform));
      let childLayerId = inheritedLayerId;
      let childIsCommBurnLayer = commBurnLayer;
      const hasLayerMetadata = [...LAYER_ATTRIBUTES].some((name) => Object.hasOwn(a, name));
      if (hasLayerMetadata) {
        if (!a["data-layer-id"] || !a["data-operation"] || !a["data-color"]) {
          fail("layer metadata requires data-layer-id, data-operation, and data-color.");
        }
        const parsed = layerFromGroup(a, layers.length, idPrefix);
        if (forceLayerId) {
          childLayerId = forceLayerId;
          childIsCommBurnLayer = true;
        } else {
          const existing = sourceLayers.get(parsed.sourceId);
          if (existing) {
            if (existing.operation !== parsed.layer.operation || existing.color !== parsed.layer.color
              || existing.name !== parsed.layer.name) {
              fail(`conflicting metadata for CommBurn layer "${parsed.sourceId}".`);
            }
            childLayerId = existing.id;
          } else {
            layers.push(parsed.layer);
            sourceLayers.set(parsed.sourceId, parsed.layer);
            childLayerId = parsed.layer.id;
          }
          childIsCommBurnLayer = true;
        }
      }
      const childStyle = { fill: a.fill ?? style.fill, stroke: a.stroke ?? style.stroke };
      stack.push(...node.children.map((child) => ({
        node: child,
        depth: depth + 1,
        layerId: childLayerId,
        commBurnLayer: childIsCommBurnLayer,
        style: childStyle,
        transform: childTransform,
        ignoredMetadata: false
      })).reverse());
      continue;
    }
    const allowed = GEOMETRY_ATTRIBUTES[node.name];
    if (!allowed) fail(`unsupported element <${node.name}>.`);
    checkedAttributes(node, allowed, `<${node.name}>`);
    const id = `${idPrefix}-${elements.length + 1}`;
    const common = {
      id, layerId: commBurnLayer || forceLayerId
        ? inheritedLayerId
        : fallbackLayerIdForElement(node.name, a, style, inheritedLayerId, layers, colorLayers, defaultLayer, idPrefix, forceLayerId),
      rotationDeg: 0, skewXDeg: 0, skewYDeg: 0
    };
    const elementTransform = multiplyTransforms(inheritedTransform, parseTransform(a.transform));
    const x = (value, label) => view.mapX(number(value, label));
    const y = (value, label) => view.mapY(number(value, label));

    if (node.name === "rect") {
      if (number(a.rx, "rx") !== 0 || number(a.ry, "ry") !== 0) fail("rounded rectangles are not supported.");
      const rectX = number(a.x, "rect x");
      const rectY = number(a.y, "rect y");
      const rectWidth = number(a.width, "rect width", NaN);
      const rectHeight = number(a.height, "rect height", NaN);
      if (!Number.isFinite(rectWidth) || !Number.isFinite(rectHeight) || rectWidth <= 0 || rectHeight <= 0) {
        fail("rect width and height must be positive finite values.");
      }
      if (axisAligned(elementTransform)) {
        const matrix = mapMatrix(view, elementTransform);
        const start = transformPoint(matrix, rectX, rectY);
        const end = transformPoint(matrix, rectX + rectWidth, rectY + rectHeight);
        elements.push({
          ...common, type: "rect",
          xMm: Math.min(start.x, end.x), yMm: Math.min(start.y, end.y),
          widthMm: Math.abs(end.x - start.x), heightMm: Math.abs(end.y - start.y)
        });
      } else {
        const shape = localTransformedPath(rectanglePath(rectX, rectY, rectWidth, rectHeight), view, elementTransform);
        elements.push({ ...common, type: "path", ...shape });
      }
    } else if (node.name === "circle" || node.name === "ellipse") {
      const cx = number(a.cx, `${node.name} cx`);
      const cy = number(a.cy, `${node.name} cy`);
      const radiusX = number(node.name === "circle" ? a.r : a.rx, `${node.name} rx`, NaN);
      const radiusY = number(node.name === "circle" ? a.r : a.ry, `${node.name} ry`, NaN);
      if (![radiusX, radiusY].every((radius) => Number.isFinite(radius) && radius > 0)) fail(`${node.name} radii must be positive.`);
      if (axisAligned(elementTransform)) {
        const matrix = mapMatrix(view, elementTransform);
        const center = transformPoint(matrix, cx, cy);
        const widthMm = Math.abs(matrix[0]) * radiusX * 2;
        const heightMm = Math.abs(matrix[3]) * radiusY * 2;
        elements.push({
          ...common, type: "ellipse",
          xMm: center.x - widthMm / 2, yMm: center.y - heightMm / 2, widthMm, heightMm
        });
      } else {
        const shape = localTransformedPath(ellipsePath(cx, cy, radiusX, radiusY), view, elementTransform);
        elements.push({ ...common, type: "path", ...shape });
      }
    } else if (node.name === "text") {
      if (node.children.some((child) => child.type !== "text")) fail("nested markup inside <text> is not supported.");
      const text = node.children.map((child) => decodeXmlEntities(child.value, "<text> content")).join("");
      const size = number(a["font-size"], "text font-size", 16);
      if (size <= 0) fail("text font-size must be positive.");
      if (a["text-anchor"] && a["text-anchor"] !== "start") fail("text-anchor values other than start are not supported.");
      if (a["dominant-baseline"] && a["dominant-baseline"] !== "auto") fail("custom text baselines are not supported.");
      const textMatrix = elementTransform;
      const transform = mapTextTransform(view, textMatrix);
      const xUser = number(a.x, "text x");
      const yUser = number(a.y, "text y");
      const textPoint = transformPoint(textMatrix, xUser, yUser);
      elements.push({
        ...common, type: "text",
        xMm: view.mapX(textPoint.x),
        yMm: view.mapY(textPoint.y),
        text, fontSizeMm: size * transform.scale, fontFamily: a["font-family"] ?? "sans-serif",
        rotationDeg: transform.rotationDeg
      });
    } else if (node.name === "image") {
      if (a.href && a["xlink:href"] && a.href !== a["xlink:href"]) fail("image href and xlink:href must match.");
      const imageDataUri = a.href ?? a["xlink:href"];
      if (typeof imageDataUri !== "string" || !imageDataUri.startsWith("data:image/")) {
        fail("only embedded PNG, JPEG, and WebP images are supported; external image references are not loaded.");
      }
      const widthMm = number(a.width, "image width", NaN) * view.scaleX;
      const heightMm = number(a.height, "image height", NaN) * view.scaleY;
      if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
        fail("image width and height must be positive finite values.");
      }
      const preserveAspectRatio = a.preserveAspectRatio ?? "xMidYMid meet";
      if (preserveAspectRatio !== "none" && !/^x(?:Min|Mid|Max)Y(?:Min|Mid|Max) meet$/.test(preserveAspectRatio)) {
        fail("image preserveAspectRatio must be none or a supported alignment with meet.");
      }
      const imageWidth = number(a.width, "image width", NaN);
      const imageHeight = number(a.height, "image height", NaN);
      const matrix = mapMatrix(view, elementTransform);
      const firstScale = Math.hypot(matrix[0], matrix[1]);
      const secondScale = Math.hypot(matrix[2], matrix[3]);
      const orthogonal = Math.abs(matrix[0] * matrix[2] + matrix[1] * matrix[3])
        <= Math.max(firstScale * secondScale, 1) * 1e-8;
      if (!orthogonal || matrix[0] * matrix[3] - matrix[1] * matrix[2] <= 0) {
        fail("image transforms must preserve orthogonal axes and orientation.");
      }
      const center = transformPoint(matrix, number(a.x, "image x") + imageWidth / 2, number(a.y, "image y") + imageHeight / 2);
      const transformedWidth = firstScale * imageWidth;
      const transformedHeight = secondScale * imageHeight;
      elements.push({
        ...common, type: "image",
        xMm: center.x - transformedWidth / 2, yMm: center.y - transformedHeight / 2,
        widthMm: transformedWidth, heightMm: transformedHeight, imageDataUri, preserveAspectRatio,
        rotationDeg: Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI
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
      const shape = localTransformedPath(pathData, view, elementTransform);
      if (shape.widthMm === 0 && shape.heightMm === 0) fail("paths must have a positive width or height.");
      elements.push({ ...common, type: "path", ...shape });
    }
  }

  if (elements.length === 0) fail("no supported editable geometry was found.");
  const normalized = createDocument({
    widthMm: view.widthMm,
    heightMm: view.heightMm,
    layers,
    elements
  });
  return {
    widthMm: normalized.widthMm,
    heightMm: normalized.heightMm,
    layers: normalized.layers,
    elements: normalized.elements
  };
}
