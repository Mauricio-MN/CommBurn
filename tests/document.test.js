import test from "node:test";
import assert from "node:assert/strict";
import { createDocument, renderGrblJob, renderSvg } from "../src/core/document.js";

test("document dimensions, positions, and SVG output use millimetres", () => {
  const document = createDocument({
    widthMm: 180, heightMm: 120,
    elements: [{ id: "label", type: "text", xMm: 10.5, yMm: 20, text: "Olá", fontSizeMm: 8 }]
  });
  assert.equal(document.widthMm, 180);
  assert.equal(document.elements[0].xMm, 10.5);
  assert.match(renderSvg(document), /width="180mm" height="120mm"/);
  assert.match(renderSvg(document), /x="10.5" y="20"/);
});

test("origin corner maps rectangle coordinates without sensor input", () => {
  const svg = renderSvg({
    widthMm: 100, heightMm: 80,
    origin: { corner: "bottom-right" },
    elements: [{ id: "box", type: "rect", xMm: 10, yMm: 5, widthMm: 20, heightMm: 15 }]
  });
  assert.match(svg, /<rect id="box" x="70" y="60" width="20" height="15"/);
});

test("SVG text and identifiers are escaped", () => {
  const svg = renderSvg({
    elements: [{ id: 'label"&', type: "text", xMm: 1, yMm: 2, text: "<&>", fontSizeMm: 4, fontFamily: 'A "font"' }]
  });
  assert.match(svg, /id="label&quot;&amp;"/);
  assert.match(svg, /&lt;&amp;&gt;/);
  assert.match(svg, /font-family="A &quot;font&quot;"/);
});

test("invalid metric dimensions, positions, and axis settings are rejected", () => {
  assert.throws(() => createDocument({ widthMm: 0 }), /greater than zero/);
  assert.throws(() => createDocument({ widthMm: Infinity }), /finite number/);
  assert.throws(() => createDocument({ elements: [{ type: "text", xMm: NaN, yMm: 0, text: "x", fontSizeMm: 1 }] }), /finite number/);
  assert.throws(() => createDocument({ origin: { flipX: "yes" } }), /must be boolean/);
  assert.throws(() => createDocument({
    elements: [
      { id: "same", type: "rect", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1 },
      { id: "same", type: "ellipse", xMm: 2, yMm: 2, widthMm: 1, heightMm: 1 }
    ]
  }), /Duplicate object id/);
  assert.throws(() => createDocument({
    elements: [{ id: "warp", type: "rect", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1, skewXDeg: 80 }]
  }), /between -80 and 80/);
});

test("GRBL job output uses explicit millimetres, user coordinates, and laser-off boundaries", () => {
  const gcode = renderGrblJob({
    widthMm: 100,
    heightMm: 80,
    origin: { corner: "bottom-right" },
    elements: [{ id: "frame", type: "rect", xMm: 10, yMm: 5, widthMm: 20, heightMm: 15 }]
  }, { feedMmPerMinute: 300, maxSpindleSpeed: 1000, powerPercent: 10 });

  assert.match(gcode, /^G21\nG90\nG94\nM5/m);
  assert.match(gcode, /G0 X90 Y75\nM4 S100\nG1 F300/);
  assert.match(gcode, /G1 X70 Y75\nG1 X70 Y60\nG1 X90 Y60\nG1 X90 Y75\nM5\nM5\n$/);
});

test("GRBL jobs reject text, out-of-area geometry, and invalid machine settings", () => {
  const settings = { feedMmPerMinute: 300, maxSpindleSpeed: 1000, powerPercent: 10 };
  assert.throws(() => renderGrblJob({
    elements: [{ type: "text", xMm: 1, yMm: 1, text: "No path", fontSizeMm: 2 }]
  }, settings), /rectangles only/);
  assert.throws(() => renderGrblJob({
    widthMm: 10, heightMm: 10,
    elements: [{ type: "rect", xMm: 8, yMm: 1, widthMm: 4, heightMm: 2 }]
  }, settings), /outside the document work area/);
  assert.throws(() => renderGrblJob({
    elements: [{ type: "rect", xMm: 1, yMm: 1, widthMm: 2, heightMm: 2 }]
  }, { ...settings, powerPercent: 101 }), /at most 100/);
});

test("GRBL paths honor explicit axis inversions", () => {
  const gcode = renderGrblJob({
    widthMm: 50,
    heightMm: 40,
    origin: { corner: "top-left", flipX: true, flipY: true },
    elements: [{ type: "rect", xMm: 5, yMm: 6, widthMm: 10, heightMm: 12 }]
  }, { feedMmPerMinute: 200, maxSpindleSpeed: 500, powerPercent: 5 });

  assert.match(gcode, /G0 X45 Y34/);
  assert.match(gcode, /G1 X35 Y34\nG1 X35 Y22\nG1 X45 Y22/);
});

test("SVG renders configurable ellipses, lines, and object transforms", () => {
  const svg = renderSvg({
    widthMm: 120,
    heightMm: 80,
    elements: [
      { id: "oval", type: "ellipse", xMm: 10, yMm: 12, widthMm: 30, heightMm: 18, rotationDeg: 30 },
      { id: "guide", type: "line", xMm: 2, yMm: 4, widthMm: 35, heightMm: 0, skewXDeg: 5 }
    ]
  });

  assert.match(svg, /<ellipse id="oval" cx="25" cy="21" rx="15" ry="9"[^>]*rotate\(30\)/);
  assert.match(svg, /<line id="guide" x1="2" y1="4" x2="37" y2="4"[^>]*skewX\(5\)/);
});

test("SVG paths remain editable, metric, and honor origin inversion", async () => {
  const { SVGPathData } = await import("../node_modules/svg-pathdata/lib/SVGPathData.module.js");
  const pathData = new SVGPathData("M 0 0 L 10 0 L 10 5 Z").encode();
  const svg = renderSvg({
    widthMm: 40,
    heightMm: 30,
    origin: { corner: "bottom-right" },
    elements: [{
      id: "outline", type: "path", pathData, xMm: 5, yMm: 4, widthMm: 10, heightMm: 5
    }]
  });
  assert.match(svg, /<path id="outline" d="M35 26L25 26L25 21z"/);
  assert.throws(() => createDocument({
    elements: [{ type: "path", xMm: 0, yMm: 0, pathData: "M nope" }]
  }), /path/i);
});

test("GRBL rejects rotated, warped, and non-rectangular objects", () => {
  const settings = { feedMmPerMinute: 100, maxSpindleSpeed: 1000, powerPercent: 5 };
  assert.throws(() => renderGrblJob({
    elements: [{ type: "rect", xMm: 1, yMm: 1, widthMm: 10, heightMm: 10, rotationDeg: 2 }]
  }, settings), /untransformed rectangles/);
  assert.throws(() => renderGrblJob({
    elements: [{ type: "ellipse", xMm: 1, yMm: 1, widthMm: 10, heightMm: 10 }]
  }, settings), /rectangles only/);
});
