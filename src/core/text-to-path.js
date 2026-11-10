import { CommBurnRangeError } from "./i18n.js";
import fonts from "./hershey-fonts.json" with { type: "json" };
import { SVGPathData } from "../../node_modules/svg-pathdata/lib/SVGPathData.module.js";

const FONT_BY_FAMILY = Object.freeze({
  "sans-serif": "futural",
  serif: "timesr",
  monospace: "futural"
});
const BASELINE = 22;
const EM_HEIGHT = 30;
const LINE_HEIGHT = 36;
const GLYPH_ADVANCE_SCALE = 1.68;
const SPACE_ADVANCE = 10;
const MAX_TEXT_CHARACTERS = 5000;
const MAX_TEXT_SEGMENTS = 100000;
const ACCENT_MARKS = new Set(["\u0300", "\u0301", "\u0302", "\u0303", "\u0308", "\u030a", "\u0327"]);

function unsupportedGlyph(character) {
  return new CommBurnRangeError(
    "grbl.unsupportedTextGlyph",
    { character },
    { message: `GRBL text contains an unsupported character: ${character}` }
  );
}

function glyphSegments(glyph) {
  const commands = new SVGPathData(glyph.d).toAbs().commands;
  const segments = [];
  let points = null;
  let start = null;
  for (const command of commands) {
    if (command.type === SVGPathData.MOVE_TO) {
      if (points?.length > 1) segments.push(points);
      start = [command.x, command.y];
      points = [start];
    } else if (command.type === SVGPathData.LINE_TO) {
      if (!points) throw new RangeError("Hershey glyph path must start with a move command");
      points.push([command.x, command.y]);
    } else if (command.type === SVGPathData.CLOSE_PATH) {
      if (points?.length > 1 && (points.at(-1)[0] !== start[0] || points.at(-1)[1] !== start[1])) {
        points.push(start);
      }
      if (points?.length > 1) segments.push(points);
      points = null;
      start = null;
    } else {
      throw new RangeError("Hershey glyph contains unsupported path geometry");
    }
  }
  if (points?.length > 1) segments.push(points);
  return segments;
}

function accentSegments(mark, centerX, minY, maxY) {
  if (mark === "\u0301") return [[[centerX - 1, minY - 2], [centerX + 2, minY - 6]]];
  if (mark === "\u0300") return [[[centerX + 1, minY - 2], [centerX - 2, minY - 6]]];
  if (mark === "\u0302") return [[[centerX - 3, minY - 2], [centerX, minY - 5], [centerX + 3, minY - 2]]];
  if (mark === "\u0303") return [[[centerX - 4, minY - 3], [centerX - 2, minY - 5], [centerX, minY - 4], [centerX + 2, minY - 2], [centerX + 4, minY - 3]]];
  if (mark === "\u0308") {
    return [
      [[centerX - 3, minY - 3], [centerX - 2, minY - 4]],
      [[centerX + 2, minY - 3], [centerX + 3, minY - 4]]
    ];
  }
  if (mark === "\u030a") {
    return [[[centerX - 1, minY - 2], [centerX - 2, minY - 3], [centerX - 1, minY - 5], [centerX + 1, minY - 5], [centerX + 2, minY - 3], [centerX + 1, minY - 2], [centerX - 1, minY - 2]]];
  }
  if (mark === "\u0327") return [[[centerX, maxY - 1], [centerX + 2, maxY + 1], [centerX, maxY + 4], [centerX - 1, maxY + 5]]];
  return null;
}

export function createTextStrokePaths(element) {
  const fontName = FONT_BY_FAMILY[element.fontFamily ?? "sans-serif"];
  if (!fontName) throw new CommBurnRangeError("grbl.unsupportedTextFont", { fontFamily: element.fontFamily });
  if (typeof element.text !== "string") throw new TypeError("Text element must contain a string");
  if (element.text.length > MAX_TEXT_CHARACTERS) {
    throw new CommBurnRangeError("grbl.textTooLong", { limit: MAX_TEXT_CHARACTERS });
  }

  const font = fonts[fontName];
  const scale = element.fontSizeMm / EM_HEIGHT;
  const monoAdvance = Math.max(...font.chars.map(({ o }) => o)) * GLYPH_ADVANCE_SCALE;
  const spaceAdvance = element.fontFamily === "monospace" ? monoAdvance * 0.6 : SPACE_ADVANCE;
  const paths = [];
  let penX = 0;
  let lineIndex = 0;
  let lastGlyph = null;
  let segmentCount = 0;

  const appendSegments = (segments, offsetX, offsetY) => {
    for (const segment of segments) {
      const points = segment.map(([x, y]) => [
        element.xMm + (offsetX + x) * scale,
        element.yMm + (offsetY + y - BASELINE) * scale
      ]);
      paths.push(points);
      segmentCount += points.length - 1;
      if (segmentCount > MAX_TEXT_SEGMENTS) {
        throw new CommBurnRangeError("grbl.textTooComplex", { limit: MAX_TEXT_SEGMENTS });
      }
    }
  };

  for (const character of element.text.normalize("NFD")) {
    if (character === "\r") continue;
    if (character === "\n") {
      penX = 0;
      lineIndex += 1;
      lastGlyph = null;
      continue;
    }
    if (character === "\t") {
      penX += spaceAdvance * 4;
      lastGlyph = null;
      continue;
    }
    if (ACCENT_MARKS.has(character)) {
      if (!lastGlyph) throw unsupportedGlyph(character);
      const marks = accentSegments(character, lastGlyph.centerX, lastGlyph.minY, lastGlyph.maxY);
      if (!marks) throw unsupportedGlyph(character);
      appendSegments(marks, lastGlyph.offsetX, lineIndex * LINE_HEIGHT);
      continue;
    }
    if (character === " " || character === "\u00a0") {
      penX += spaceAdvance;
      lastGlyph = null;
      continue;
    }

    const codePoint = character.codePointAt(0);
    const glyph = codePoint >= 33 && codePoint <= 126 ? font.chars[codePoint - 33] : null;
    if (!glyph?.d) throw unsupportedGlyph(character);

    const segments = glyphSegments(glyph);
    const allPoints = segments.flat();
    const minX = Math.min(...allPoints.map(([x]) => x));
    const maxX = Math.max(...allPoints.map(([x]) => x));
    const minY = Math.min(...allPoints.map(([, y]) => y));
    const maxY = Math.max(...allPoints.map(([, y]) => y));
    const offsetY = lineIndex * LINE_HEIGHT;
    appendSegments(segments, penX, offsetY);
    lastGlyph = { centerX: (minX + maxX) / 2, minY, maxY, offsetX: penX };
    penX += element.fontFamily === "monospace"
      ? monoAdvance
      : Number(glyph.o) * GLYPH_ADVANCE_SCALE;
  }

  return paths;
}