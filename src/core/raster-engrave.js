import { CommBurnRangeError } from "./i18n.js";

export const RASTER_MODES = ["grayscale", "dither", "threshold"];
export const RASTER_MAX_PIXELS = 4_000_000;
const GRAYSCALE_LEVELS = 32;

export function decodeRaster(id, raster) {
  const { widthPx, heightPx, gray } = raster ?? {};
  if (!Number.isInteger(widthPx) || !Number.isInteger(heightPx) || widthPx < 1 || heightPx < 1 || widthPx * heightPx > RASTER_MAX_PIXELS) {
    throw new CommBurnRangeError("grbl.invalidRaster", { id }, { message: `Raster for ${id} has invalid dimensions` });
  }
  const binary = atob(typeof gray === "string" ? gray : "");
  if (binary.length !== widthPx * heightPx) {
    throw new CommBurnRangeError("grbl.invalidRaster", { id }, { message: `Raster for ${id} does not match its dimensions` });
  }
  return { widthPx, heightPx, pixels: Uint8Array.from(binary, (character) => character.charCodeAt(0)) };
}

// Darkness per pixel as an integer level: 0 = no laser, GRAYSCALE_LEVELS = full power; binary modes only use both ends.
export function rasterLevels({ widthPx, heightPx, pixels }, mode) {
  if (!RASTER_MODES.includes(mode)) {
    throw new CommBurnRangeError("grbl.invalidRasterMode", { mode }, { message: `Unsupported image engraving mode: ${mode}` });
  }
  const darkness = Float64Array.from(pixels, (value) => 1 - value / 255);
  const levels = new Uint8Array(pixels.length);
  if (mode === "dither") {
    for (let row = 0; row < heightPx; row += 1) {
      for (let column = 0; column < widthPx; column += 1) {
        const index = row * widthPx + column;
        const output = darkness[index] >= 0.5 ? 1 : 0;
        const error = darkness[index] - output;
        levels[index] = output * GRAYSCALE_LEVELS;
        if (column + 1 < widthPx) darkness[index + 1] += error * 7 / 16;
        if (row + 1 < heightPx) {
          if (column > 0) darkness[index + widthPx - 1] += error * 3 / 16;
          darkness[index + widthPx] += error * 5 / 16;
          if (column + 1 < widthPx) darkness[index + widthPx + 1] += error / 16;
        }
      }
    }
  } else {
    for (let index = 0; index < levels.length; index += 1) {
      levels[index] = mode === "threshold"
        ? (darkness[index] >= 0.5 ? GRAYSCALE_LEVELS : 0)
        : Math.round(darkness[index] * GRAYSCALE_LEVELS);
    }
  }
  return { levels, maxLevel: GRAYSCALE_LEVELS };
}

// One scan line per pixel row: equal-level runs between the first and last burned pixel.
export function rasterRowRuns(levels, widthPx, row) {
  const offset = row * widthPx;
  let first = 0;
  while (first < widthPx && levels[offset + first] === 0) first += 1;
  if (first === widthPx) return [];
  let last = widthPx - 1;
  while (levels[offset + last] === 0) last -= 1;
  const runs = [];
  let start = first;
  for (let column = first + 1; column <= last + 1; column += 1) {
    if (column === last + 1 || levels[offset + column] !== levels[offset + start]) {
      runs.push({ fromPx: start, toPx: column, level: levels[offset + start] });
      start = column;
    }
  }
  return runs;
}
