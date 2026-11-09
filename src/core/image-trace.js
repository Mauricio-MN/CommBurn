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

export function importTracedImageSvg(tree, options) {
  const widthMm = positiveFinite(options.widthMm, "widthMm");
  const heightMm = positiveFinite(options.heightMm, "heightMm");
  const sourceLayer = options.sourceLayer;
  if (!sourceLayer || sourceLayer.locked) {
    throw new RangeError("image vectors require an unlocked layer");
  }

  const root = cloneNode(tree);
  if (root.name !== "svg" || root.type !== "element") throw new TypeError("Image tracer output must have an SVG root");
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
    if (element.type !== "path") throw new TypeError("Image tracer output contains non-path geometry");
    const color = colorsByLayer.get(element.layerId);
    if (!color) throw new RangeError(`Traced path refers to missing color "${element.layerId}"`);
    return { ...element, layerId: sourceLayer.id, color };
  });
  if (elements.length > MAX_PATHS) {
    throw new RangeError(`Image tracing creates more than ${MAX_PATHS} paths; reduce the color count or detail`);
  }
  if (elements.length === 0) throw new RangeError("Image tracing produced no vector regions");
  const bounds = elements.reduce((result, element) => ({
    minX: Math.min(result.minX, element.xMm),
    minY: Math.min(result.minY, element.yMm),
    maxX: Math.max(result.maxX, element.xMm + element.widthMm),
    maxY: Math.max(result.maxY, element.yMm + element.heightMm)
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const tracedWidthMm = bounds.maxX - bounds.minX;
  const tracedHeightMm = bounds.maxY - bounds.minY;
  if (![tracedWidthMm, tracedHeightMm].every(Number.isFinite) || tracedWidthMm <= 0 || tracedHeightMm <= 0) {
    throw new RangeError("Image tracing produced invalid vector bounds");
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
      xMm: left,
      yMm: top,
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
