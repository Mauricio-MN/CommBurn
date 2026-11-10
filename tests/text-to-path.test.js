import test from "node:test";
import assert from "node:assert/strict";
import { createTextStrokePaths } from "../src/core/text-to-path.js";

test("Hershey text conversion creates metric strokes for each editor font family", () => {
  for (const fontFamily of ["sans-serif", "serif", "monospace"]) {
    const paths = createTextStrokePaths({
      xMm: 10,
      yMm: 20,
      text: "AB",
      fontFamily,
      fontSizeMm: 30
    });
    assert.ok(paths.length > 0, `${fontFamily} should create paths`);
    assert.ok(paths.every((path) => path.length >= 2 && path.flat().every(Number.isFinite)));
    assert.ok(Math.min(...paths.flat().map(([x]) => x)) >= 10);
    assert.ok(Math.min(...paths.flat().map(([, y]) => y)) < 20);
  }
});

test("Hershey text conversion composes Portuguese accents and supports line breaks", () => {
  const paths = createTextStrokePaths({
    xMm: 0,
    yMm: 30,
    text: "Ação\nOlá",
    fontFamily: "sans-serif",
    fontSizeMm: 8
  });
  const rows = new Set(paths.map((path) => Math.round(Math.min(...path.map(([, y]) => y)) * 100) / 100));

  assert.ok(paths.length > 8);
  assert.ok(Math.max(...paths.flat().map(([, y]) => y)) > 30);
  assert.ok(Math.min(...paths.flat().map(([, y]) => y)) < 25);
  assert.ok(rows.size > 1);
});

test("Hershey text conversion rejects characters without a glyph instead of dropping them", () => {
  assert.throws(
    () => createTextStrokePaths({ xMm: 0, yMm: 0, text: "日本", fontSizeMm: 8 }),
    (error) => error.code === "grbl.unsupportedTextGlyph"
  );
});