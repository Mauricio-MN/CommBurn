import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { importTracedImageSvg } from "../src/core/image-trace.js";
import { DEFAULT_LAYER } from "../src/core/layers.js";

const require = createRequire(import.meta.url);
const svgson = require("svgson");

function svgTree(pathData) {
  return svgson.parseSync(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><path fill="#000000" d="${pathData}"/></svg>`);
}

test("oversized traced paths split into element-sized groups without separating holes from their outlines", () => {
  // 4000 cells, each an outer square with one hole: the whole path exceeds the trace budget.
  const parts = [];
  for (let row = 0; row < 50; row += 1) {
    for (let col = 0; col < 80; col += 1) {
      const x = col * 12;
      const y = row * 19;
      parts.push(`M ${x} ${y} L ${x + 10} ${y} L ${x + 10} ${y + 10} L ${x} ${y + 10} Z`);
      parts.push(`M ${x + 3} ${y + 3} L ${x + 7} ${y + 3} L ${x + 7} ${y + 7} L ${x + 3} ${y + 7} Z`);
    }
  }
  const imported = importTracedImageSvg(svgTree(parts.join(" ")), {
    widthMm: 100,
    heightMm: 100,
    sourceLayer: DEFAULT_LAYER,
    idPrefix: "split-holes"
  });

  assert.ok(imported.elements.length > 1);
  assert.ok(imported.elements.every((element) => element.pathData.length <= 1_000_000));
  const moves = imported.elements.map((element) => (element.pathData.match(/M/gi) ?? []).length);
  assert.equal(moves.reduce((sum, count) => sum + count, 0), 8000);
  assert.ok(moves.every((count) => count % 2 === 0));
});

test("a single traced region that is too large reports a stable error code", () => {
  // One outer contour with 14400 holes is one region and cannot be split without breaking its holes.
  const parts = ["M 0 0 L 1000 0 L 1000 1000 L 0 1000 Z"];
  for (let row = 0; row < 120; row += 1) {
    for (let col = 0; col < 120; col += 1) {
      const x = col * 8 + 2;
      const y = row * 8 + 2;
      parts.push(`M ${x} ${y} L ${x + 4} ${y} L ${x + 4} ${y + 4} L ${x} ${y + 4} Z`);
    }
  }
  assert.throws(() => importTracedImageSvg(svgTree(parts.join(" ")), {
    widthMm: 100,
    heightMm: 100,
    sourceLayer: DEFAULT_LAYER,
    idPrefix: "single-region"
  }), { code: "imageTrace.tooLarge" });
});
