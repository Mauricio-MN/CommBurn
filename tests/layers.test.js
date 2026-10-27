import test from "node:test";
import assert from "node:assert/strict";
import { createDocument, planGrblJob, renderGrblJob, renderSvg } from "../src/core/document.js";

const machineSettings = { maxSpindleSpeed: 1000 };

test("documents assign legacy objects to a default configurable layer", () => {
  const document = createDocument({
    elements: [{ id: "frame", type: "rect", xMm: 1, yMm: 1, widthMm: 10, heightMm: 10 }]
  });

  assert.deepEqual(document.layers[0], {
    id: "layer-engrave",
    name: "Gravação 1",
    operation: "engrave",
    feedMmPerMinute: 300,
    powerPercent: 10,
    passes: 1,
    fillSpacingMm: 1,
    fillAlgorithm: "horizontal-serpentine",
    objectOrder: "document",
    enabled: true,
    visible: true,
    locked: false,
    color: "#3978eb"
  });
  assert.equal(document.elements[0].layerId, document.layers[0].id);
});

test("SVG groups objects by layer and honors visibility and fill display", () => {
  const svg = renderSvg({
    widthMm: 100,
    heightMm: 80,
    layers: [
      { id: "outline", name: "Corte", operation: "cut", color: "#e58a2d" },
      { id: "inside", name: "Preenchimento", operation: "fill", color: "#32a77f" },
      { id: "hidden", name: "Oculta", operation: "engrave", visible: false }
    ],
    elements: [
      { id: "edge", type: "rect", xMm: 1, yMm: 1, widthMm: 10, heightMm: 10, layerId: "outline" },
      { id: "filled", type: "rect", xMm: 20, yMm: 20, widthMm: 15, heightMm: 12, layerId: "inside" },
      { id: "not-shown", type: "rect", xMm: 40, yMm: 20, widthMm: 10, heightMm: 10, layerId: "hidden" }
    ]
  });

  assert.match(svg, /data-layer-id="outline" data-layer-name="Corte" data-operation="cut"/);
  assert.match(svg, /<rect id="filled"[^>]*fill="#32a77f"/);
  assert.doesNotMatch(svg, /id="not-shown"/);
});

test("GRBL uses each layer operation, feed, power, pass count, fill spacing, and enabled state", () => {
  const gcode = renderGrblJob({
    widthMm: 80,
    heightMm: 50,
    layers: [
      { id: "engrave", name: "Gravação", operation: "engrave", feedMmPerMinute: 200, powerPercent: 5 },
      { id: "cut", name: "Corte", operation: "cut", feedMmPerMinute: 80, powerPercent: 40, passes: 2 },
      { id: "fill", name: "Preenchimento", operation: "fill", feedMmPerMinute: 150, powerPercent: 20, fillSpacingMm: 2 },
      { id: "skip", name: "Ignorar", operation: "cut", enabled: false }
    ],
    elements: [
      { id: "engrave-box", type: "rect", xMm: 1, yMm: 1, widthMm: 5, heightMm: 4, layerId: "engrave" },
      { id: "cut-box", type: "rect", xMm: 10, yMm: 1, widthMm: 5, heightMm: 4, layerId: "cut" },
      { id: "fill-box", type: "rect", xMm: 20, yMm: 1, widthMm: 4, heightMm: 4, layerId: "fill" },
      { id: "skip-box", type: "rect", xMm: 30, yMm: 1, widthMm: 5, heightMm: 4, layerId: "skip" }
    ]
  }, machineSettings);

  assert.match(gcode, /M4 S50\nG1 F200/);
  assert.match(gcode, /M4 S400\nG1 F80/);
  assert.match(gcode, /M4 S200\nG1 F150/);
  assert.equal((gcode.match(/G0 X10 Y1/g) ?? []).length, 2);
  assert.equal((gcode.match(/G1 F150/g) ?? []).length, 3);
  assert.match(gcode, /G0 X20 Y1\nM4 S200\nG1 F150\nG1 X24 Y1/);
  assert.doesNotMatch(gcode, /X30 Y1/);
});

test("layer configurations and object layer references are validated", () => {
  assert.throws(() => createDocument({ layers: [] }), /at least one layer/);
  assert.throws(() => createDocument({
    layers: [{ id: "bad", operation: "unknown" }]
  }), /unsupported operation/);
  assert.throws(() => createDocument({
    layers: [{ id: "bad", operation: "fill", fillSpacingMm: 0 }]
  }), /greater than zero/);
  assert.throws(() => createDocument({
    elements: [{ type: "rect", xMm: 0, yMm: 0, widthMm: 1, heightMm: 1, layerId: "missing" }]
  }), /references unknown layer/);
  assert.equal(createDocument({
    layers: [{ id: "custom", color: "#12aBcD" }]
  }).layers[0].color, "#12abcd");
  assert.throws(() => createDocument({
    layers: [{ id: "invalid-color", color: "red" }]
  }), /six-digit hexadecimal/);
});

test("GRBL filled layers reject unsafe scan-line counts", () => {
  assert.throws(() => renderGrblJob({
    layers: [{ id: "dense", operation: "fill", fillSpacingMm: 0.000001 }],
    elements: [{ type: "rect", xMm: 1, yMm: 1, widthMm: 1, heightMm: 1, layerId: "dense" }]
  }, machineSettings), /too many scan lines/);
});

test("GRBL fill algorithms create horizontal, vertical, crosshatch, and unidirectional paths", () => {
  const document = {
    widthMm: 40,
    heightMm: 30,
    layers: [{ id: "fill", operation: "fill", fillSpacingMm: 2 }],
    elements: [{ id: "box", type: "rect", xMm: 10, yMm: 10, widthMm: 4, heightMm: 3, layerId: "fill" }]
  };
  const planFor = (fillAlgorithm) => planGrblJob({
    ...document,
    layers: [{ ...document.layers[0], fillAlgorithm }]
  }, machineSettings);

  const horizontal = planFor("horizontal-serpentine");
  assert.equal(horizontal.paths.filter((path) => path.kind === "work").length, 2);
  assert.deepEqual(horizontal.paths.filter((path) => path.kind === "work").map((path) =>
    path.points.map(({ xMm, yMm }) => [xMm, yMm])
  ), [
    [[10, 10], [14, 10]],
    [[14, 12], [10, 12]]
  ]);
  const vertical = planFor("vertical-serpentine");
  assert.equal(vertical.paths.filter((path) => path.kind === "work").length, 3);
  const crosshatch = planFor("crosshatch");
  assert.equal(crosshatch.paths.filter((path) => path.kind === "work").length, 5);
  const unidirectional = planFor("horizontal-unidirectional");
  assert.deepEqual(unidirectional.paths.filter((path) => path.kind === "work").map((path) => path.points[0].xMm), [10, 10]);
  assert.ok(crosshatch.paths.some((path) => path.kind === "travel"));
  assert.match(crosshatch.gcode, /M5\nG0 X/);
});

test("GRBL object ordering supports nearest-next and center-out, and reports rapid travel", () => {
  const base = {
    widthMm: 100,
    heightMm: 60,
    layers: [{ id: "engrave", objectOrder: "document" }],
    elements: [
      { id: "edge", type: "rect", xMm: 80, yMm: 40, widthMm: 4, heightMm: 4, layerId: "engrave" },
      { id: "near-origin", type: "rect", xMm: 5, yMm: 5, widthMm: 4, heightMm: 4, layerId: "engrave" },
      { id: "center", type: "rect", xMm: 48, yMm: 28, widthMm: 4, heightMm: 4, layerId: "engrave" }
    ]
  };
  const orderedIds = (objectOrder) => planGrblJob({
    ...base,
    layers: [{ id: "engrave", objectOrder }]
  }, machineSettings).paths.filter((path) => path.kind === "work").map((path) => path.elementId);

  assert.deepEqual(orderedIds("document"), ["edge", "near-origin", "center"]);
  assert.deepEqual(orderedIds("nearest").filter((id, index, list) => index === 0 || list[index - 1] !== id), [
    "near-origin", "center", "edge"
  ]);
  assert.deepEqual(orderedIds("center-out").filter((id, index, list) => index === 0 || list[index - 1] !== id), [
    "center", "edge", "near-origin"
  ]);

  const nearest = planGrblJob({ ...base, layers: [{ id: "engrave", objectOrder: "nearest" }] }, machineSettings);
  assert.equal(nearest.stats.rapidMoveCount, nearest.paths.filter((path) => path.kind === "travel").length);
  assert.ok(nearest.stats.travelDistanceMm > 0);
  assert.equal(renderGrblJob({ ...base, layers: [{ id: "engrave" }] }, machineSettings), planGrblJob({
    ...base, layers: [{ id: "engrave" }]
  }, machineSettings).gcode);
});

test("layer fill and object-order algorithms reject unknown values", () => {
  assert.throws(() => createDocument({ layers: [{ id: "bad", fillAlgorithm: "spiral" }] }), /unsupported fill algorithm/);
  assert.throws(() => createDocument({ layers: [{ id: "bad", objectOrder: "random" }] }), /unsupported object order/);
});
