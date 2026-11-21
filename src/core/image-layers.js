// Raster images never share a layer with vector objects, so these helpers keep images in their own layers.

const kindOf = (element) => element.type === "image" ? "raster" : "vector";

// True when every element in `layerId`, plus `movedIds` once moved there, is the same kind.
export function canMoveElementsToLayer(elements, movedIds, layerId) {
  const kinds = new Set(elements.filter((element) => element.layerId === layerId && !movedIds.has(element.id)).map(kindOf));
  elements.filter((element) => movedIds.has(element.id)).forEach((element) => kinds.add(kindOf(element)));
  return kinds.size <= 1;
}

export function layerAcceptsKind(elements, layerId, kind) {
  return elements.every((element) => element.layerId !== layerId || kindOf(element) === kind);
}

// Layers that can receive vectors converted from `sourceId`: unlocked and free of other raster images.
export function vectorTargetLayers(layers, elements, sourceId) {
  return layers.filter((layer) => !layer.locked && !elements.some((element) =>
    element.layerId === layer.id && element.type === "image" && element.id !== sourceId));
}

export function moveImagesToLayer(elements, layerId) {
  return elements.map((element) => element.type === "image" ? { ...element, layerId } : element);
}
