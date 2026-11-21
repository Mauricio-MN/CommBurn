import test from "node:test";
import assert from "node:assert/strict";
import { createTextOutlinePathData } from "../src/core/text-to-path.js";
import { SVGPathData } from "../node_modules/svg-pathdata/lib/SVGPathData.module.js";

test("OpenType text conversion creates filled vector outlines for each editor font family", () => {
  for (const fontFamily of ["sans-serif", "serif", "monospace"]) {
    const pathData = createTextOutlinePathData({
      xMm: 10,
      yMm: 20,
      text: "AB",
      fontFamily,
      fontSizeMm: 30
    });
    const outline = new SVGPathData(pathData).toAbs();
    assert.ok(pathData.length > 0, `${fontFamily} should create an outline`);
    assert.ok(outline.commands.some(({ type }) => type === SVGPathData.QUAD_TO || type === SVGPathData.CURVE_TO));
    assert.ok(outline.commands.some(({ type }) => type === SVGPathData.CLOSE_PATH));
  }
});

test("OpenType text conversion supports Portuguese accents, spaces, and line breaks", () => {
  const pathData = createTextOutlinePathData({
    xMm: 0,
    yMm: 30,
    text: "Ação\nOlá",
    fontFamily: "sans-serif",
    fontSizeMm: 8
  });
  const path = new SVGPathData(pathData);
  const bounds = path.getBounds();

  assert.ok(path.commands.length > 20);
  assert.ok(bounds.maxY > 30);
  assert.ok(bounds.minY < 25);
  assert.ok(path.commands.filter(({ type }) => type === SVGPathData.MOVE_TO).length > 8);
});

test("OpenType text conversion rejects characters without a glyph instead of dropping them", () => {
  assert.throws(
    () => createTextOutlinePathData({ xMm: 0, yMm: 0, text: "日本", fontSizeMm: 8 }),
    (error) => error.code === "grbl.unsupportedTextGlyph"
  );
});
test("G-code text outlines reject bold and italic instead of silently sending regular glyphs", () => {
  const base = { xMm: 0, yMm: 0, text: "A", fontSizeMm: 8 };
  assert.throws(
    () => createTextOutlinePathData({ ...base, fontWeight: "bold" }),
    (error) => error.code === "grbl.unsupportedTextStyle"
  );
  assert.throws(
    () => createTextOutlinePathData({ ...base, fontStyle: "italic" }),
    (error) => error.code === "grbl.unsupportedTextStyle"
  );
  assert.ok(createTextOutlinePathData({ ...base, fontWeight: "normal", fontStyle: "normal" }).length > 0);
});
