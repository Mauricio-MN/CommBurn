import { CommBurnRangeError } from "./i18n.js";
import * as opentype from "../../node_modules/opentype.js/dist/opentype.mjs";

const FONT_BY_FAMILY = Object.freeze({
  "sans-serif": { file: "DejaVuSans.woff", svgFamily: "CommBurn Sans" },
  serif: { file: "DejaVuSerif.woff", svgFamily: "CommBurn Serif" },
  monospace: { file: "DejaVuSansMono.woff", svgFamily: "CommBurn Mono" }
});
const MAX_TEXT_CHARACTERS = 5000;
const MAX_TEXT_SEGMENTS = 100000;

const loadedFonts = new Map(await Promise.all(Object.entries(FONT_BY_FAMILY).map(async ([family, definition]) => {
  const url = new URL(`./fonts/${definition.file}`, import.meta.url);
  let bytes;
  if (import.meta.url.startsWith("file:")) {
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(url);
    bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  } else {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load bundled font: ${definition.file}`);
    bytes = await response.arrayBuffer();
  }
  return [family, { ...definition, bytes, font: opentype.parse(bytes) }];
})));

function unsupportedGlyph(character) {
  return new CommBurnRangeError(
    "grbl.unsupportedTextGlyph",
    { character },
    { message: `GRBL text contains an unsupported character: ${character}` }
  );
}

export function getTextSvgFamily(fontFamily = "sans-serif") {
  return FONT_BY_FAMILY[fontFamily]?.svgFamily ?? fontFamily;
}

export function getTextFontAsset(fontFamily = "sans-serif") {
  const font = loadedFonts.get(fontFamily);
  if (!font) return null;
  return { family: font.svgFamily, bytes: font.bytes };
}

export function createTextOutlinePathData(element) {
  const font = loadedFonts.get(element.fontFamily ?? "sans-serif")?.font;
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