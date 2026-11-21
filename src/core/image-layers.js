// Raster images never share a layer with vector objects, so these helpers keep images in their own layers.

// Layers that can receive vectors converted from `sourceId`: unlocked and free of other raster images.
export function vectorTargetLayers(layers, elements, sourceId) {
  return layers.filter((layer) => !layer.locked && !elements.some((element) =>
    element.layerId === layer.id && element.type === "image" && element.id !== sourceId));
}

export function moveImagesToLayer(elements, layerId) {
  return elements.map((element) => element.type === "image" ? { ...element, layerId } : element);
}
