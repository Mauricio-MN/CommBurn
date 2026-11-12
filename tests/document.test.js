import test from "node:test";
import assert from "node:assert/strict";
import { createDocument, planGrblJob, renderGrblJob, renderSvg } from "../src/core/document.js";

const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6ioAAAAASUVORK5CYII=";
const embeddedSvg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm"><circle cx="5" cy="5" r="4"/></svg>').toString("base64")}`;

test("document dimensions, positions, and SVG output use millimetres", () => {
  const document = createDocument({
    widthMm: 180, heightMm: 120,
    elements: [{ id: "label", type: "text", xMm: 10.5, yMm: 20, text: "Olá", fontSizeMm: 8 }]
  });
  assert.equal(document.widthMm, 180);
  assert.equal(document.elements[0].xMm, 10.5);
  assert.match(renderSvg(document), /width="180mm" height="120mm"/);
  assert.match(renderSvg(document), /<text id="label" font-family="CommBurn Sans"/);
});

test("origin corner maps rectangle coordinates without sensor input", () => {
  const svg = renderSvg({
    widthMm: 100, heightMm: 80,
    origin: { corner: "bottom-right" },
    elements: [{ id: "box", type: "rect", xMm: 10, yMm: 5, widthMm: 20, heightMm: 15 }]
  });
  assert.match(svg, /<rect id="box" x="70" y="60" width="20" height="15"/);
});

test("SVG text uses native font text and identifiers are escaped", () => {
  const svg = renderSvg({
    elements: [{ id: 'label"&', type: "text", xMm: 1, yMm: 12, text: "<&>", fontSizeMm: 4, fontFamily: "sans-serif" }]
  });
  assert.match(svg, /id="label&quot;&amp;"/);
  assert.match(svg, /font-family="CommBurn Sans"/);
  assert.match(svg, /<tspan x="1" y="12">&lt;&amp;&gt;<\/tspan>/);
});

test("SVG text preserves external font names while GRBL rejects missing outlines", () => {
  const documentModel = {
    elements: [{ id: "label", type: "text", xMm: 1, yMm: 8, text: "Text", fontSizeMm: 4, fontFamily: "Liberation Serif" }]
  };

  assert.match(renderSvg(documentModel), /font-family="Liberation Serif"/);
  assert.throws(
    () => planGrblJob(documentModel, { maxSpindleSpeed: 1000 }),
    (error) => error.code === "grbl.unsupportedTextFont"
  );
});

test("text SVG keeps native text and embeds the selected font with inverted coordinates", () => {
  const documentModel = {
    widthMm: 100,
    heightMm: 80,
    origin: { corner: "top-right", flipY: true },
    layers: [{ id: "engrave", operation: "engrave", color: "#267b62" }],
    elements: [{ id: "label", type: "text", xMm: 10, yMm: 25, text: "AB", fontSizeMm: 8, layerId: "engrave" }]
  };
  const svg = renderSvg(documentModel);

  assert.match(svg, /<text id="label" font-family="CommBurn Sans" font-size="8" font-kerning="none"/);
  assert.match(svg, /<tspan x="90" y="55">AB<\/tspan>/);
  assert.match(svg, /@font-face\{font-family:"CommBurn Sans"/);
  assert.equal(documentModel.elements[0].type, "text");
});

test("invalid metric dimensions, positions, and axis settings are rejected", () => {
  assert.throws(() => createDocument({ widthMm: 0 }), { code: "document.positiveNumber" });
  assert.throws(() => createDocument({ widthMm: Infinity }), { code: "document.invalidNumber" });
  assert.throws(() => createDocument({ elements: [{ type: "text", xMm: NaN, yMm: 0, text: "x", fontSizeMm: 1 }] }), /finite number/);
  assert.throws(() => createDocument({ origin: { flipX: "yes" } }), /must be boolean/);
  assert.throws(() => createDocument({
    elements: [
      { id: "same", type: "rect", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1 },
      { id: "same", type: "ellipse", xMm: 2, yMm: 2, widthMm: 1, heightMm: 1 }
    ]
  }), { code: "document.duplicateId" });
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
  // The closed contour begins at the vertex nearest the machine zero, here the bottom-right corner of the table.
  assert.match(gcode, /G0 X70 Y60\nM4 S100\nG1 F300/);
  assert.match(gcode, /G1 X90 Y60\nG1 X90 Y75\nG1 X70 Y75\nG1 X70 Y60\nM5\nM5\n$/);
});

test("GRBL exports text and rejects out-of-area geometry and invalid machine settings", () => {
  const settings = { feedMmPerMinute: 300, maxSpindleSpeed: 1000, powerPercent: 10 };
  const textJob = renderGrblJob({
    widthMm: 100, heightMm: 80,
    elements: [{ id: "label", type: "text", xMm: 10, yMm: 25, text: "Ação", fontSizeMm: 8 }]
  }, settings);
  assert.match(textJob, /M4 S100/);
  assert.match(textJob, /G1 X/);
  assert.ok(textJob.split("\n").filter((line) => line.startsWith("G0 ")).length > 5);
  assert.throws(() => renderGrblJob({
    widthMm: 10, heightMm: 10,
    elements: [{ type: "rect", xMm: 8, yMm: 1, widthMm: 4, heightMm: 2 }]
  }, settings), { code: "grbl.outsideWorkArea" });
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

  assert.match(gcode, /G0 X35 Y22/);
  assert.match(gcode, /G1 X45 Y22\nG1 X45 Y34\nG1 X35 Y34\nG1 X35 Y22/);
});

test("GRBL text stays upright when the selected origin inverts an axis", () => {
  const documentModel = {
    widthMm: 100,
    heightMm: 80,
    elements: [{ id: "label", type: "text", xMm: 10, yMm: 25, text: "AB", fontSizeMm: 8 }]
  };
  const settings = { feedMmPerMinute: 300, maxSpindleSpeed: 1000 };
  const normalPaths = planGrblJob(documentModel, settings).paths
    .filter(({ kind, elementId }) => kind === "work" && elementId === "label");
  const flippedPaths = planGrblJob({ ...documentModel, origin: { corner: "top-right" } }, settings).paths
    .filter(({ kind, elementId }) => kind === "work" && elementId === "label");
  const byPosition = (a, b) => a.yMm - b.yMm || a.xMm - b.xMm;
  const unique = (points) => points.sort(byPosition)
    .filter((point, index, all) => index === 0 || byPosition(point, all[index - 1]) !== 0);
  const normalPoints = unique(normalPaths.flatMap(({ points }) => points));
  const flippedPoints = unique(flippedPaths.flatMap(({ points }) => points));

  assert.equal(flippedPoints.length, normalPoints.length);
  assert.equal(new Set(normalPoints.map((point, index) => (flippedPoints[index].xMm - point.xMm).toFixed(6))).size, 1);
  assert.ok(flippedPoints[0].xMm > normalPoints[0].xMm);
});

test("GRBL text contours follow fill, engrave, and cut layer operations", () => {
  const plan = planGrblJob({
    layers: [
      { id: "fill", operation: "fill", fillAlgorithm: "vertical-serpentine", fillSpacingMm: 0.5 },
      { id: "engrave", operation: "engrave" },
      { id: "cut", operation: "cut" }
    ],
    elements: [
      { type: "text", xMm: 1, yMm: 8, text: "Open strokes", fontSizeMm: 4, layerId: "fill" },
      { id: "closed", type: "rect", xMm: 20, yMm: 20, widthMm: 2, heightMm: 2, layerId: "fill" },
      { id: "engraved-text", type: "text", xMm: 30, yMm: 20, text: "AB", fontSizeMm: 4, layerId: "engrave" },
      { id: "cut-text", type: "text", xMm: 40, yMm: 20, text: "AB", fontSizeMm: 4, layerId: "cut" }
    ]
  }, { maxSpindleSpeed: 1000 });
  const textPaths = plan.paths.filter(({ kind, elementId }) => kind === "work" && elementId === "element-1");
  const closedShapePaths = plan.paths.filter(({ kind, elementId }) => kind === "work" && elementId === "closed");
  const engravedTextPaths = plan.paths.filter(({ kind, elementId }) => kind === "work" && elementId === "engraved-text");
  const cutTextPaths = plan.paths.filter(({ kind, elementId }) => kind === "work" && elementId === "cut-text");

  assert.ok(textPaths.length > 10);
  assert.ok(textPaths.every(({ operation, algorithm }) => operation === "fill" && algorithm === "vertical-serpentine"));
  assert.ok(closedShapePaths.length > 0);
  assert.ok(closedShapePaths.every(({ operation, algorithm }) => operation === "fill" && algorithm === "vertical-serpentine"));
  assert.ok(engravedTextPaths.length > 0);
  assert.ok(engravedTextPaths.every(({ operation, algorithm }) => operation === "engrave" && algorithm === "outline"));
  assert.ok(cutTextPaths.length > 0);
  assert.ok(cutTextPaths.every(({ operation, algorithm }) => operation === "cut" && algorithm === "outline"));
  assert.ok(plan.stats.estimatedWorkTimeSecondsByOperation.fill > 0);
  assert.ok(plan.stats.estimatedWorkTimeSecondsByOperation.engrave > 0);
  assert.ok(plan.stats.estimatedWorkTimeSecondsByOperation.cut > 0);
  assert.match(plan.gcode, /M4 S/);
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

test("embedded raster images remain metric and are rejected by the GRBL adapter", () => {
  const document = createDocument({
    widthMm: 50,
    heightMm: 40,
    elements: [{
      id: "photo", type: "image", xMm: 1.5, yMm: 2, widthMm: 20, heightMm: 10,
      imageDataUri: onePixelPng, preserveAspectRatio: "xMidYMid meet"
    }]
  });

  assert.match(renderSvg(document), /<image id="photo" x="1.5" y="2" width="20" height="10" href="data:image\/png;base64,/);
  assert.throws(() => createDocument({
    elements: [{ type: "image", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1, imageDataUri: "https://example.invalid/image.png" }]
  }), /embedded PNG, JPEG, or WebP/);
  assert.throws(() => renderGrblJob(document, { maxSpindleSpeed: 1000 }), /editable vector paths/);
});

test("embedded SVG visual objects are preserved by SVG export and rejected by GRBL", () => {
  const document = createDocument({
    widthMm: 50,
    heightMm: 40,
    elements: [{
      id: "complex-art", type: "svg-image", xMm: 2, yMm: 3,
      widthMm: 10, heightMm: 10, svgDataUri: embeddedSvg
    }]
  });

  assert.match(renderSvg(document), /<image id="complex-art" x="2" y="3" width="10" height="10" href="data:image\/svg\+xml;base64,/);
  assert.throws(() => createDocument({
    elements: [{
      type: "svg-image", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1,
      svgDataUri: `data:image/svg+xml;base64,${Buffer.from('<svg><script>alert(1)</script></svg>').toString("base64")}`
    }]
  }), /active or external content/);
  const nested = Buffer.from('<svg width="2mm" height="2mm"><circle cx="1" cy="1" r="1"/></svg>').toString("base64");
  const nestedSvg = `data:image/svg+xml;base64,${Buffer.from(`<svg width="10mm" height="10mm"><image href="data:image/svg+xml;base64,${nested}"/></svg>`).toString("base64")}`;
  assert.doesNotThrow(() => createDocument({
    elements: [{ type: "svg-image", xMm: 0, yMm: 0, widthMm: 10, heightMm: 10, svgDataUri: nestedSvg }]
  }));
  const unsafeNested = Buffer.from('<svg><script>alert(1)</script></svg>').toString("base64");
  const unsafeOuter = `data:image/svg+xml;base64,${Buffer.from(`<svg><image href="data:image/svg+xml;base64,${unsafeNested}"/></svg>`).toString("base64")}`;
  assert.throws(() => createDocument({
    elements: [{ type: "svg-image", xMm: 0, yMm: 0, widthMm: 10, heightMm: 10, svgDataUri: unsafeOuter }]
  }), /active or external content/);
  assert.throws(() => renderGrblJob(document, { maxSpindleSpeed: 1000 }), /editable vector paths/);
});

test("GRBL follows rotation and skew, and rejects non-rectangular primitives", () => {
  const settings = { feedMmPerMinute: 100, maxSpindleSpeed: 1000, powerPercent: 5 };
  const rotated = planGrblJob({
    widthMm: 100, heightMm: 100,
    elements: [{ type: "rect", xMm: 10, yMm: 10, widthMm: 10, heightMm: 10, rotationDeg: 90 }]
  }, settings);
  // A square rotated 90 degrees around its centre (15, 15) keeps the same corners, starting from the next one.
  assert.deepEqual(rotated.paths[0].points.slice(0, 2).map(({ xMm, yMm }) => ({ xMm, yMm })), [{ xMm: 10, yMm: 10 }, { xMm: 20, yMm: 10 }]);
  const skewed = planGrblJob({
    widthMm: 100, heightMm: 100,
    elements: [{ type: "rect", xMm: 10, yMm: 10, widthMm: 10, heightMm: 10, skewXDeg: 45 }]
  }, settings);
  assert.deepEqual([skewed.paths[0].points[0].xMm, skewed.paths[0].points[0].yMm], [5, 10]);
  assert.throws(() => renderGrblJob({
    elements: [{ type: "ellipse", xMm: 1, yMm: 1, widthMm: 10, heightMm: 10 }]
  }, settings), /editable vector paths/);
});

test("GRBL traces editable SVG paths and applies each vector's engraving power", () => {
  const gcode = renderGrblJob({
    widthMm: 20,
    heightMm: 20,
    layers: [{ id: "engrave", operation: "engrave", powerPercent: 10 }],
    elements: [{
      id: "stroke",
      type: "path",
      xMm: 2,
      yMm: 3,
      widthMm: 4,
      heightMm: 0,
      pathData: "M 0 0 L 4 0",
      powerPercent: 35,
      layerId: "engrave"
    }]
  }, { maxSpindleSpeed: 1000 });

  assert.match(gcode, /G0 X2 Y3\nM4 S350/);
  assert.match(gcode, /G1 X6 Y3/);
});

test("GRBL flattens cubic SVG path curves into metric line segments", () => {
  const gcode = renderGrblJob({
    widthMm: 20,
    heightMm: 20,
    elements: [{
      type: "path",
      xMm: 2,
      yMm: 3,
      widthMm: 5,
      heightMm: 3,
      pathData: "M 0 0 C 0 5 5 5 5 0"
    }]
  }, { maxSpindleSpeed: 1000 });

  assert.ok((gcode.match(/G1 X/g) ?? []).length > 8);
  assert.match(gcode, /G0 X2 Y3/);
});
