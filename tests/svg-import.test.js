import test from "node:test";
import assert from "node:assert/strict";
import { parseSync } from "svgson";
import { importSvgTree, validateSvgSource } from "../src/core/svg-import.js";
import { renderSvg } from "../src/core/document.js";
import { DEFAULT_LAYER } from "../src/core/layers.js";

function importSvg(source, options) {
  return importSvgTree(parseSync(source), options);
}

test("SVG import converts viewBox coordinates and editable primitives to millimetres", () => {
  const imported = importSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 200 100">
      <rect x="20" y="10" width="40" height="20"/>
      <circle cx="100" cy="50" r="10"/>
      <text x="10" y="80" font-size="8">Laser</text>
      <path d="M 120 10 C 140 10 140 30 120 30 Z"/>
    </svg>`, { layerId: "layer-cut", idPrefix: "input" });

  assert.equal(imported.widthMm, 100);
  assert.equal(imported.heightMm, 50);
  assert.deepEqual(imported.elements.map(({ type }) => type), ["rect", "ellipse", "text", "path"]);
  assert.deepEqual(
    (({ xMm, yMm, widthMm, heightMm }) => ({ xMm, yMm, widthMm, heightMm }))(imported.elements[0]),
    { xMm: 10, yMm: 5, widthMm: 20, heightMm: 10 }
  );
  assert.equal(imported.elements[0].layerId, "layer-cut");
  assert.equal(imported.elements[2].fontSizeMm, 4);
  assert.match(renderSvg({ ...imported, layers: [{ ...DEFAULT_LAYER, id: "layer-cut" }] }), /<path id="input-4"/);
});

test("SVG import preserves the default viewBox aspect ratio and converts physical units", () => {
  const imported = importSvg('<svg width="10cm" height="100mm" viewBox="10 20 200 100"><rect x="10" y="20" width="20" height="10"/></svg>');
  assert.equal(imported.widthMm, 100);
  assert.equal(imported.heightMm, 100);
  assert.equal(imported.elements[0].xMm, 0);
  assert.equal(imported.elements[0].yMm, 25);
  assert.equal(imported.elements[0].widthMm, 10);
  assert.equal(imported.elements[0].heightMm, 5);
});

test("SVG text imports uniform scale, translation, and rotation transforms", () => {
  const imported = importSvg(`
    <svg width="100mm" height="50mm" viewBox="0 0 200 100">
      <text x="10" y="20" font-size="8" transform="translate(5,3) scale(2) rotate(90)">Laser</text>
    </svg>`);
  const [text] = imported.elements;
  assert.equal(text.xMm, -17.5);
  assert.ok(Math.abs(text.yMm - 11.5) < 1e-9);
  assert.equal(text.fontSizeMm, 8);
  assert.equal(text.rotationDeg, 90);
  assert.match(renderSvg(imported), /font-size="8"[^>]*rotate\(90\)/);
});

test("SVG import rejects active content, unsupported geometry, and unsafe attributes", () => {
  assert.throws(() => validateSvgSource('<!DOCTYPE svg [<!ENTITY x "unsafe">]>'), /DOCTYPE and entity declarations/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><script>alert(1)</script></svg>'), /unsupported element <script>/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><rect x="0" y="0" width="2" height="2" onclick="alert(1)"/></svg>'), /unsupported <rect> attribute "onclick"/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><image href="https://example.invalid/a.png"/></svg>'), /unsupported element <image>/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><path d="M0 0L1 1" transform="scale(2)"/></svg>'), /transform attributes are not supported/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><text x="1" y="2" transform="scale(2 1)">No</text></svg>'), /non-uniform scale/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><g transform="translate(1 2)"><text x="1" y="2">No</text></g></svg>'), /transform attributes are not supported/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><rect x="0" y="0" width="2" height="2" style="fill:url(x)"/></svg>'), /unsupported <rect> attribute "style"/);
});

test("SVG import enforces finite dimensions, non-empty geometry, and supported text", () => {
  assert.throws(() => importSvg('<svg width="Infinity" height="10mm"><rect width="2" height="2"/></svg>'), /width must use/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><rect width="-1" height="2"/></svg>'), /rect width and height/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><text><tspan>unsafe nested text</tspan></text></svg>'), /nested markup inside <text>/);
  assert.throws(() => importSvg('<svg width="10mm" height="10mm"><metadata>not geometry</metadata></svg>'), /unsupported element <metadata>/);
});
