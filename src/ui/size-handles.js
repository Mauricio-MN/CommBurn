// Selection box with grab handles for the size tool: four corners and four edge midpoints, like
// consolidated editors. Each handle is a position on the box (0, 0.5 or 1 per axis).
export const SIZE_HANDLES = Object.freeze({
  nw: { x: 0, y: 0 }, n: { x: 0.5, y: 0 }, ne: { x: 1, y: 0 }, e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 }, s: { x: 0.5, y: 1 }, sw: { x: 0, y: 1 }, w: { x: 0, y: 0.5 }
});

const MIN_SIZE_MM = 0.1;
const GRIP_PX = 9;
const EDGE_PX = 10;
const SVG_NS = "http://www.w3.org/2000/svg";

export function isCornerHandle(handle) {
  return handle.length === 2;
}

// Bounds are { left, top, right, bottom } in mm. The side opposite the dragged handle stays fixed.
// Edge handles stretch one axis. Corner handles stretch both axes, or keep the proportions when
// `proportional` is set. Sizes never fall below 0.1 mm (the box does not flip), and an axis that
// starts with zero size is left alone. Returns the new bounds and the scale factor of each axis.
export function resizeBounds(start, handle, point, { proportional = false } = {}) {
  const spec = SIZE_HANDLES[handle];
  if (!spec) throw new RangeError(`Alça de tamanho desconhecida: ${handle}`);
  const width = start.right - start.left;
  const height = start.bottom - start.top;
  let newWidth = width;
  let newHeight = height;
  if (spec.x !== 0.5 && width > 0) {
    newWidth = Math.max(MIN_SIZE_MM, spec.x === 1 ? point.x - start.left : start.right - point.x);
  }
  if (spec.y !== 0.5 && height > 0) {
    newHeight = Math.max(MIN_SIZE_MM, spec.y === 1 ? point.y - start.top : start.bottom - point.y);
  }
  if (proportional && isCornerHandle(handle) && width > 0 && height > 0) {
    const scale = Math.max(newWidth / width, newHeight / height, MIN_SIZE_MM / width, MIN_SIZE_MM / height);
    newWidth = width * scale;
    newHeight = height * scale;
  }
  const bounds = {
    left: spec.x === 0 ? start.right - newWidth : start.left,
    right: spec.x === 1 ? start.left + newWidth : start.right,
    top: spec.y === 0 ? start.bottom - newHeight : start.top,
    bottom: spec.y === 1 ? start.top + newHeight : start.bottom
  };
  return {
    bounds,
    sx: width > 0 ? (bounds.right - bounds.left) / width : 1,
    sy: height > 0 ? (bounds.bottom - bounds.top) / height : 1
  };
}

// Patch that moves one element along with the selection box. Text only has a font size, so it
// scales uniformly: by the changed axis for an edge handle, by the average for a corner.
// Raster images are stretched to the new box (preserveAspectRatio "none").
export function scaleElementPatch(element, start, bounds, sx, sy) {
  if (element.type === "text") {
    const textScale = sx === 1 ? sy : sy === 1 ? sx : (sx + sy) / 2;
    const fontSizeMm = element.fontSizeMm * textScale;
    const top = element.yMm - element.fontSizeMm;
    return {
      xMm: bounds.left + (element.xMm - start.left) * sx,
      yMm: bounds.top + (top - start.top) * sy + fontSizeMm,
      fontSizeMm
    };
  }
  const patch = {
    xMm: bounds.left + (element.xMm - start.left) * sx,
    yMm: bounds.top + (element.yMm - start.top) * sy,
    widthMm: element.widthMm * sx,
    heightMm: element.heightMm * sy
  };
  if (element.type === "image") patch.preserveAspectRatio = "none";
  return patch;
}

// Draws the box, invisible grab strips along the four edges, and the eight grips. Sizes are in
// screen pixels, so `mmPerPixel` converts them to the drawing's millimetres at the current zoom.
export function renderSizeHandles(group, bounds, mmPerPixel = 1) {
  group.replaceChildren();
  if (!bounds) return;
  const make = (className, attributes) => {
    const node = document.createElementNS(SVG_NS, "rect");
    node.setAttribute("class", className);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    return node;
  };
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const grip = GRIP_PX * mmPerPixel;
  const edge = EDGE_PX * mmPerPixel;
  const nodes = [make("size-box", { x: bounds.left, y: bounds.top, width, height })];
  const strips = {
    n: { x: bounds.left, y: bounds.top - edge / 2, width, height: edge },
    s: { x: bounds.left, y: bounds.bottom - edge / 2, width, height: edge },
    w: { x: bounds.left - edge / 2, y: bounds.top, width: edge, height },
    e: { x: bounds.right - edge / 2, y: bounds.top, width: edge, height }
  };
  for (const [handle, rectangle] of Object.entries(strips)) {
    nodes.push(make("size-edge", { ...rectangle, "data-size-handle": handle }));
  }
  for (const [handle, spec] of Object.entries(SIZE_HANDLES)) {
    nodes.push(make("size-grip", {
      x: bounds.left + width * spec.x - grip / 2,
      y: bounds.top + height * spec.y - grip / 2,
      width: grip,
      height: grip,
      "data-size-handle": handle
    }));
  }
  group.append(...nodes);
}
