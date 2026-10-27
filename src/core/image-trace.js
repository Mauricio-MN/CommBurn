import { importSvgTree } from "./svg-import.js";

const MAX_PATHS = 15_000;

function positiveFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite number greater than zero`);
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

function powerFromColor(color, minimumPowerPercent, maximumPowerPercent) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) throw new TypeError(`Traced color "${color}" is not a six-digit hex color`);
  const [red, green, blue] = [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const power = Math.round(maximumPowerPercent * (255 - luminance) / 255);
  return power < minimumPowerPercent ? 0 : Math.max(1, power);
}

export function importTracedImageSvg(tree, options) {
  const widthMm = positiveFinite(options.widthMm, "widthMm");
  const heightMm = positiveFinite(options.heightMm, "heightMm");
  const minimumPowerPercent = options.minimumPowerPercent;
  const maximumPowerPercent = options.maximumPowerPercent;
  if (![minimumPowerPercent, maximumPowerPercent].every((value) => Number.isFinite(value))
    || minimumPowerPercent < 0 || maximumPowerPercent <= 0 || maximumPowerPercent > 100
    || minimumPowerPercent > maximumPowerPercent) {
    throw new RangeError("power range must satisfy 0 <= minimum <= maximum <= 100");
  }
  const sourceLayer = options.sourceLayer;
  if (!sourceLayer || sourceLayer.operation !== "engrave" || sourceLayer.locked) {
    throw new RangeError("image traces require an unlocked engraving layer");
  }

  const root = cloneNode(tree);
  if (root.name !== "svg" || root.type !== "element") throw new TypeError("Image tracer output must have an SVG root");
  delete root.attributes.desc;
  root.attributes.width = `${widthMm}mm`;
  root.attributes.height = `${heightMm}mm`;
  root.attributes.preserveAspectRatio = "none";
  root.children = root.children.map((node) => {
    if (node.type !== "element" || node.name !== "path") return node;
    const color = node.attributes.fill ?? node.attributes.stroke;
    return {
      ...node,
      attributes: { ...node.attributes, fill: "none", stroke: color }
    };
  });

  const imported = importSvgTree(root, {
    layerId: sourceLayer.id,
    fallbackLayer: sourceLayer,
    idPrefix: options.idPrefix
  });
  const layersById = new Map(imported.layers.map((layer) => [layer.id, layer]));
  const elements = [];
  for (const element of imported.elements) {
    if (element.type !== "path") throw new TypeError("Image tracer output contains non-path geometry");
    const layer = layersById.get(element.layerId);
    if (!layer) throw new RangeError(`Traced path refers to missing layer "${element.layerId}"`);
    const powerPercent = powerFromColor(layer.color, minimumPowerPercent, maximumPowerPercent);
    if (powerPercent === 0) continue;
    elements.push({ ...element, powerPercent });
    if (elements.length > MAX_PATHS) {
      throw new RangeError(`Image tracing creates more than ${MAX_PATHS} paths; increase spacing or reduce the palette`);
    }
  }
  if (elements.length === 0) throw new RangeError("The selected palette and power filters produced no engraving paths");
  const usedLayerIds = new Set(elements.map((element) => element.layerId));
  return {
    elements,
    layers: imported.layers.filter((layer) => layer.id !== sourceLayer.id && usedLayerIds.has(layer.id)),
    stats: {
      pathCount: elements.length,
      colorCount: usedLayerIds.size
    }
  };
}
