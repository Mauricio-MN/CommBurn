import { CommBurnRangeError } from "./i18n.js";
import * as opentype from "../../node_modules/opentype.js/dist/opentype.mjs";

// Only these bundled OpenType families produce laser outlines. Other font names (system fonts) are
// stored and drawn by name, but cannot be converted into G-code geometry.
const FAMILY_FILE_BASE = Object.freeze({
  "sans-serif": "DejaVuSans",
  serif: "DejaVuSerif",
  monospace: "DejaVuSansMono",
  "CommBurn Sans": "DejaVuSans",
  "CommBurn Serif": "DejaVuSerif",
  "CommBurn Mono": "DejaVuSansMono"
});
const STYLE_FILE_SUFFIX = Object.freeze({
  "normal|normal": "",
  "bold|normal": "-Bold",
  "normal|italic": "-Oblique",
  "bold|italic": "-BoldOblique"
});
const OUTLINE_FILES = [...new Set(Object.values(FAMILY_FILE_BASE))]
  .flatMap((base) => Object.values(STYLE_FILE_SUFFIX).map((suffix) => `${base}${suffix}.woff`));
const MAX_TEXT_CHARACTERS = 5000;
const MAX_TEXT_SEGMENTS = 100000;

const loadedFiles = new Map(await Promise.all(OUTLINE_FILES.map(async (file) => {
  const url = new URL(`./fonts/${file}`, import.meta.url);
  let bytes;
  if (import.meta.url.startsWith("file:")) {
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(url);
    bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  } else {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load bundled font: ${file}`);
    bytes = await response.arrayBuffer();
  }
  return [file, opentype.parse(bytes)];
})));

function resolveOutlineFont(fontFamily = "sans-serif", fontWeight = "normal", fontStyle = "normal") {
  // A single bundled name only: a font list such as "Arial, sans-serif" would silently
  // outline with a different face than the one shown on screen.
  const name = String(fontFamily).trim().replace(/^(["'])(.*)\1$/, "$2");
  if (!Object.hasOwn(FAMILY_FILE_BASE, name)) return null;
  const suffix = STYLE_FILE_SUFFIX[`${fontWeight}|${fontStyle}`];
  return suffix === undefined ? null : loadedFiles.get(`${FAMILY_FILE_BASE[name]}${suffix}.woff`);
}

function unsupportedGlyph(character) {
  return new CommBurnRangeError(
    "grbl.unsupportedTextGlyph",
    { character },
    { message: `GRBL text contains an unsupported character: ${character}` }
  );
}

export function createTextOutlinePathData(element) {
  const font = resolveOutlineFont(element.fontFamily ?? "sans-serif", element.fontWeight ?? "normal", element.fontStyle ?? "normal");
  if (!font) throw new CommBurnRangeError("grbl.unsupportedTextFont", { fontFamily: element.fontFamily });
  if (typeof element.text !== "string") throw new TypeError("Text element must contain a string");
  if (element.text.length > MAX_TEXT_CHARACTERS) {
    throw new CommBurnRangeError("grbl.textTooLong", { limit: MAX_TEXT_CHARACTERS });
  }

  const path = new opentype.Path();
  const scale = element.fontSizeMm / font.unitsPerEm;
  const spaceAdvance = font.charToGlyph(" ").advanceWidth * scale;
  let segmentCount = 0;
  const lines = element.text.normalize("NFC").replace(/\r\n?/g, "\n").split("\n");

  for (const [lineIndex, line] of lines.entries()) {
    let penX = element.xMm;
    const baseline = element.yMm + lineIndex * element.fontSizeMm * 1.2;
    for (const character of line) {
      if (character === "\t") {
        penX += spaceAdvance * 4;
        continue;
      }
      const glyph = font.charToGlyph(character);
      if (glyph.index === 0 && character !== "\u0000") throw unsupportedGlyph(character);
      const glyphPath = glyph.getPath(penX, baseline, element.fontSizeMm, font);
      let contourOpen = false;
      for (const command of glyphPath.commands) {
        if (command.type === "M" && contourOpen) path.closePath();
        path.commands.push(command);
        contourOpen = command.type === "M" || (contourOpen && command.type !== "Z");
      }
      if (contourOpen) path.closePath();
      segmentCount += glyphPath.commands.length;
      if (segmentCount > MAX_TEXT_SEGMENTS) {
        throw new CommBurnRangeError("grbl.textTooComplex", { limit: MAX_TEXT_SEGMENTS });
      }
      penX += glyph.advanceWidth * scale;
    }
  }

  return path.commands.length ? path.toPathData(6) : "";
}