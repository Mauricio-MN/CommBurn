import test from "node:test";
import assert from "node:assert/strict";
import { createDocument, jobReferencePoints, jobStartSettings, machineFrame, planGrblJob, planToDocumentSpace, renderGrblJob, renderSvg, stageToMachine } from "../src/core/document.js";
import { DEFAULT_LAYER } from "../src/core/layers.js";

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
  assert.match(gcode, /G1 X90 Y60\nG1 X90 Y75\nG1 X70 Y75\nG1 X70 Y60\nM5\nM5\nG0 X0 Y0\n$/);
});

test("GRBL job returns the laser head to its start point after the last cut without homing", () => {
  const settings = { feedMmPerMinute: 300, maxSpindleSpeed: 1000, powerPercent: 10 };
  const base = { widthMm: 100, heightMm: 80, origin: { corner: "top-left" }, elements: [{ id: "r", type: "rect", xMm: 30, yMm: 20, widthMm: 10, heightMm: 6 }] };
  const absolute = renderGrblJob(base, settings);
  assert.doesNotMatch(absolute, /\$H|G28/);
  assert.match(absolute, /M5\nG0 X0 Y0\n$/);
  const head = renderGrblJob(base, { ...settings, ...jobStartSettings("head", "center") });
  assert.match(head, /M5\nG0 X0 Y0\n$/);
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
  const document = {
    widthMm: 50,
    heightMm: 40,
    elements: [{ type: "rect", xMm: 5, yMm: 6, widthMm: 10, heightMm: 12 }]
  };
  const settings = { feedMmPerMinute: 200, maxSpindleSpeed: 500, powerPercent: 5 };
  const normal = renderGrblJob({ ...document, origin: { corner: "top-left" } }, settings);
  const bottomLeft = renderGrblJob({ ...document, origin: { corner: "bottom-left" } }, settings);
  const normalStart = normal.match(/G0 X[^\n]+/)[0];
  const normalWork = normal.match(/G1 X[^\n]*/g).join("\n");

  assert.match(normal, /G0 X5 Y6/);
  assert.notEqual(bottomLeft.match(/G0 X[^\n]+/)[0], normalStart);
  // Reversing an axis moves machine zero to the opposite edge, so it matches the corner origin on that side.
  const equivalents = [
    [{ corner: "top-left", flipX: true }, "top-right"],
    [{ corner: "top-left", flipY: true }, "bottom-left"],
    [{ corner: "top-left", flipX: true, flipY: true }, "bottom-right"]
  ];
  for (const [origin, corner] of equivalents) {
    const inverted = renderGrblJob({ ...document, origin }, settings);
    assert.equal(inverted, renderGrblJob({ ...document, origin: { corner } }, settings));
    assert.notEqual(inverted.match(/G0 X[^\n]+/)[0], normalStart);
  }
});

test("every origin point is accepted and centred axes put machine zero mid-bed", () => {
  const points = ["top-left", "top-center", "top-right", "left-center", "center", "right-center", "bottom-left", "bottom-center", "bottom-right"];
  for (const corner of points) {
    assert.doesNotThrow(() => createDocument({ widthMm: 100, heightMm: 80, origin: { corner }, elements: [] }), corner);
  }
  const frame = machineFrame(createDocument({ widthMm: 100, heightMm: 80, origin: { corner: "top-center" }, elements: [] }));
  assert.deepEqual(frame.originMm, { xMm: 50, yMm: 0 });
  assert.deepEqual([frame.xDirection, frame.yDirection], [1, 1]);
});

test("GRBL text keeps its stage position for every origin corner and fills glyphs with open-free contours", () => {
  const documentModel = {
    widthMm: 100,
    heightMm: 80,
    layers: [{ ...DEFAULT_LAYER, id: "fill", operation: "fill", fillSpacingMm: 1 }],
    elements: [{ id: "label", type: "text", xMm: 10, yMm: 25, text: "Lu", fontSizeMm: 8, layerId: "fill" }]
  };
  const settings = { feedMmPerMinute: 300, maxSpindleSpeed: 1000 };
  const stageKey = (input) => planToDocumentSpace(input, planGrblJob(input, settings)).paths
    .filter(({ kind }) => kind === "work")
    .flatMap(({ points }) => points)
    .map(({ xMm, yMm }) => `${xMm.toFixed(3)},${yMm.toFixed(3)}`)
    .sort();
  const reference = stageKey(documentModel);

  for (const corner of ["top-right", "bottom-left", "bottom-right"]) {
    assert.deepEqual(stageKey({ ...documentModel, origin: { corner } }), reference, corner);
  }
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

test("raster images engrave as scan lines with per-segment power", () => {
  const image = {
    widthMm: 100, heightMm: 100, origin: "top-left",
    layers: [{ id: "L1", name: "Img", operation: "engrave", color: "#000000", feedMmPerMinute: 1000, powerPercent: 50, passes: 1, fillSpacingMm: 1, fillAlgorithm: "horizontal-serpentine", objectOrder: "document", enabled: true, visible: true, locked: false }],
    elements: [{ id: "photo", type: "image", xMm: 10, yMm: 10, widthMm: 4, heightMm: 2, layerId: "L1",
      imageDataUri: "data:image/png;base64,iVBORw0KGgo=" }]
  };
  const gray = Buffer.from([0, 128, 255, 0, 255, 255, 255, 255]).toString("base64");
  const rasters = { photo: { widthPx: 4, heightPx: 2, gray } };
  const plan = planGrblJob(image, { maxSpindleSpeed: 1000, rasters, imageMode: "grayscale" });
  const rows = plan.paths.filter(({ kind }) => kind === "work");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].points.map(({ xMm }) => xMm), [10, 11, 12, 13, 14]);
  assert.match(plan.gcode, /G1 X11 Y10\.5 S500/);
  assert.match(plan.gcode, /G1 X12 Y10\.5 S\d{3}/);
  const dither = planGrblJob(image, { maxSpindleSpeed: 1000, rasters, imageMode: "threshold" });
  assert.doesNotMatch(dither.gcode, /S2\d\d/);
  assert.throws(() => planGrblJob(image, { maxSpindleSpeed: 1000, rasters: { photo: { widthPx: 4, heightPx: 2, gray: "AA==" } } }), /does not match/);
  assert.throws(() => planGrblJob(image, { maxSpindleSpeed: 1000 }), /GRBL supports/);
});

test("GRBL rotated text follows the rotated outline instead of the upright outline", () => {
  const settings = { feedMmPerMinute: 300, maxSpindleSpeed: 1000 };
  const bounds = (documentModel) => {
    const points = planGrblJob(documentModel, settings).paths
      .filter(({ kind, elementId }) => kind === "work" && elementId === "label")
      .flatMap(({ points }) => points);
    const xs = points.map(({ xMm }) => xMm);
    const ys = points.map(({ yMm }) => yMm);
    return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  };
  const base = { widthMm: 100, heightMm: 80, elements: [{ id: "label", type: "text", xMm: 10, yMm: 25, text: "AB", fontSizeMm: 8 }] };
  const upright = bounds(base);
  const quarterTurn = bounds({ ...base, elements: [{ ...base.elements[0], rotationDeg: 90 }] });

  assert.ok(upright.width > upright.height);
  assert.ok(Math.abs(quarterTurn.width - upright.height) < 1e-3);
  assert.ok(Math.abs(quarterTurn.height - upright.width) < 1e-3);
});

test("GRBL rotated raster images engrave instead of rejecting the transform", () => {
  const image = {
    widthMm: 100, heightMm: 100, origin: "top-left",
    layers: [{ id: "L1", name: "Img", operation: "engrave", color: "#000000", feedMmPerMinute: 1000, powerPercent: 50, passes: 1, fillSpacingMm: 1, fillAlgorithm: "horizontal-serpentine", objectOrder: "document", enabled: true, visible: true, locked: false }],
    elements: [{ id: "photo", type: "image", xMm: 10, yMm: 10, widthMm: 4, heightMm: 2, rotationDeg: 90, layerId: "L1",
      imageDataUri: "data:image/png;base64,iVBORw0KGgo=" }]
  };
  const gray = Buffer.from([0, 128, 255, 0, 255, 255, 255, 255]).toString("base64");
  const plan = planGrblJob(image, { maxSpindleSpeed: 1000, rasters: { photo: { widthPx: 4, heightPx: 2, gray } }, imageMode: "grayscale" });
  const points = plan.paths.filter(({ kind }) => kind === "work").flatMap(({ points }) => points);
  const xs = points.map(({ xMm }) => xMm);
  const ys = points.map(({ yMm }) => yMm);

  // A 90 degree turn about the image centre (12, 11) moves the 4 x 2 mm box to 2 x 4 mm.
  assert.ok(Math.min(...xs) >= 11 - 1e-6 && Math.max(...xs) <= 13 + 1e-6);
  assert.ok(Math.min(...ys) >= 9 - 1e-6 && Math.max(...ys) <= 13 + 1e-6);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 3);
});

test("axis inversion does not move the job start marker on the stage", () => {
  const elements = [{ id: "box", type: "rect", xMm: 10, yMm: 10, widthMm: 20, heightMm: 10 }];
  const settings = { feedMmPerMinute: 300, maxSpindleSpeed: 1000 };
  const startOn = (origin) => jobReferencePoints({ widthMm: 100, heightMm: 80, elements, origin }, settings).start;

  assert.deepEqual(startOn({ corner: "top-left", flipY: true }), startOn({ corner: "top-left" }));
  assert.deepEqual(startOn({ corner: "top-left", flipX: true, flipY: true }), startOn({ corner: "top-left" }));
});

test("machine zero sits on the chosen edge and the bed always maps to [0, W] x [0, H]", () => {
  const base = { widthMm: 100, heightMm: 80, layers: [], elements: [] };
  for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
    for (const flipX of [false, true]) {
      for (const flipY of [false, true]) {
        const frame = machineFrame({ ...base, origin: { corner, flipX, flipY } });
        const corners = [[0, 0], [100, 0], [0, 80], [100, 80]].map(([x, y]) => stageToMachine(frame, x, y));
        const xs = corners.map(({ xMm }) => xMm);
        const ys = corners.map(({ yMm }) => yMm);
        assert.equal(Math.min(...xs), 0, `${corner} flipX=${flipX} flipY=${flipY}`);
        assert.equal(Math.max(...xs), 100);
        assert.equal(Math.min(...ys), 0);
        assert.equal(Math.max(...ys), 80);
        assert.equal(stageToMachine(frame, frame.originMm.xMm, frame.originMm.yMm).xMm, 0);
      }
    }
  }
});

test("the start choice maps to one job mode and the head marker sits on the chosen point for every machine corner", () => {
  assert.deepEqual(jobStartSettings("absolute"), { startFrom: "absolute", startAnchor: "top-left" });
  assert.deepEqual(jobStartSettings("head", "center"), { startFrom: "objects", startAnchor: "center" });
  const base = {
    widthMm: 100, heightMm: 80,
    layers: [{ ...DEFAULT_LAYER, id: "l" }],
    elements: [{ id: "r", type: "rect", xMm: 30, yMm: 20, widthMm: 10, heightMm: 6, layerId: "l" }]
  };
  const settings = { feedMmPerMinute: 300, maxSpindleSpeed: 1000, powerPercent: 10 };
  const headAt = { "top-left": { xMm: 30, yMm: 20 }, "bottom-right": { xMm: 40, yMm: 26 }, center: { xMm: 35, yMm: 23 } };
  for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
    const table = jobReferencePoints({ ...base, origin: { corner } }, { ...settings, ...jobStartSettings("absolute") });
    const zero = { "top-left": { xMm: 0, yMm: 0 }, "top-right": { xMm: 100, yMm: 0 }, "bottom-left": { xMm: 0, yMm: 80 }, "bottom-right": { xMm: 100, yMm: 80 } }[corner];
    assert.deepEqual(table.origin, zero, `table origin ${corner}`);
    for (const anchor of Object.keys(headAt)) {
      const ref = jobReferencePoints({ ...base, origin: { corner } }, { ...settings, ...jobStartSettings("head", anchor) });
      assert.deepEqual(ref.origin, headAt[anchor], `head on ${anchor} with origin ${corner}`);
    }
  }
});

test("GRBL vector power follows junction speed only when controller laser mode is off", () => {
  const input = {
    widthMm: 100,
    heightMm: 100,
    layers: [{ ...DEFAULT_LAYER, id: "cut" }],
    elements: [{
      id: "square", type: "path", xMm: 10, yMm: 10, widthMm: 40, heightMm: 40,
      pathData: "M0 0 L40 0 L40 40 L0 40 Z",
      layerId: "cut"
    }]
  };
  const sValues = (controllerLaserMode) => {
    const plan = planGrblJob(input, { feedMmPerMinute: 1200, maxSpindleSpeed: 1000, controllerLaserMode });
    return plan.gcode.split("\n").filter((line) => /^G1 X.* S\d+$/.test(line))
      .map((line) => Number(line.match(/S(\d+)$/)[1]));
  };

  assert.deepEqual(sValues(1), []);
  const compensated = sValues(0);
  assert.ok(compensated.length > 0);
  assert.ok(Math.min(...compensated) < 300);
});

test("GRBL curves use tolerance-based segments without zero-length moves", () => {
  const plan = planGrblJob({
    widthMm: 100,
    heightMm: 100,
    layers: [{ ...DEFAULT_LAYER, id: "engrave" }],
    elements: [{
      id: "circle", type: "path", xMm: 10, yMm: 10, widthMm: 40, heightMm: 40,
      pathData: "M0 20 C0 9 9 0 20 0 C31 0 40 9 40 20 C40 31 31 40 20 40 C9 40 0 31 0 20 Z",
      layerId: "engrave"
    }]
  }, { feedMmPerMinute: 1200, maxSpindleSpeed: 1000 });
  const lengths = plan.paths.filter(({ kind }) => kind === "work")
    .flatMap(({ points }) => points.slice(1).map((point, index) => Math.hypot(point.xMm - points[index].xMm, point.yMm - points[index].yMm)));

  assert.ok(Math.min(...lengths) > 0.5);
});
