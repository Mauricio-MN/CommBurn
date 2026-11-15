// Pure zoom math for the workspace stage. The DOM wiring lives in app.js.
// Zoom 1 (100%) is the default fit-to-stage size; it is never persisted in the project.

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 16;
export const ZOOM_DEFAULT = 1;
export const ZOOM_STEP = 1.25;

export function clampZoom(level) {
  if (!Number.isFinite(level)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
}

export function zoomByFactor(level, factor) {
  return clampZoom(level * factor);
}

export function zoomPercent(level) {
  return `${Math.round(level * 100)}%`;
}

// Returns the scroll change that keeps the content point under `anchor` in place
// after the content box is resized. `previous` and `next` describe one axis of the
// content box: `start` is its client coordinate and `size` its length in pixels.
export function scrollDeltaToKeepAnchor(anchor, previous, next) {
  if (!(previous.size > 0)) return 0;
  const fraction = (anchor - previous.start) / previous.size;
  return next.start + fraction * next.size - anchor;
}
