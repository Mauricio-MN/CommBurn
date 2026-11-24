import test from "node:test";
import assert from "node:assert/strict";
import { createDocument, jobReferencePoints, planGrblJob, planToDocumentSpace, renderGrblJob, renderSvg } from "../src/core/document.js";
import { parseProject, serializeProject } from "../src/core/project.js";
import { interpretGcodeLine } from "../src/machine/motion-model.js";

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

test("GRBL plan estimates work time per operation using configured feed and passes", () => {
  const plan = planGrblJob({
    widthMm: 80,
    heightMm: 50,
    layers: [
      { id: "engrave", operation: "engrave", feedMmPerMinute: 120 },
      { id: "cut", operation: "cut", feedMmPerMinute: 60, passes: 2 },
      { id: "fill", operation: "fill", feedMmPerMinute: 240, fillSpacingMm: 2 }
    ],
    elements: [
      { id: "engrave-box", type: "rect", xMm: 1, yMm: 1, widthMm: 5, heightMm: 4, layerId: "engrave" },
      { id: "cut-box", type: "rect", xMm: 10, yMm: 1, widthMm: 2, heightMm: 3, layerId: "cut" },
      { id: "fill-box", type: "rect", xMm: 20, yMm: 1, widthMm: 4, heightMm: 4, layerId: "fill" }
    ]
  }, machineSettings);

  assert.deepEqual(plan.stats.estimatedWorkTimeSecondsByOperation, {
    engrave: 9,
    cut: 20,
    fill: 3
  });
});

test("layer configurations and object layer references are validated", () => {
  assert.throws(() => createDocument({ layers: [] }), (error) => {
    assert.ok(error instanceof RangeError);
    assert.equal(error.code, "layers.invalidCount");
    assert.match(error.message, /at least one layer/);
    return true;
  });
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
  }, machineSettings), /excede 50\.000 linhas de varredura/);
});

test("GRBL fills a 180 by 120 mm rectangle at 0.05 mm spacing", () => {
  const plan = planGrblJob({
    widthMm: 180,
    heightMm: 120,
    layers: [{ id: "fill", operation: "fill", fillSpacingMm: 0.05 }],
    elements: [{ id: "full-area", type: "rect", xMm: 0, yMm: 0, widthMm: 180, heightMm: 120, layerId: "fill" }]
  }, machineSettings);

  assert.equal(plan.stats.workPathCount, 2401);
  assert.equal(plan.paths.find((path) => path.kind === "work").points[0].yMm, 0);
  assert.equal(plan.paths.filter((path) => path.kind === "work").at(-1).points[0].yMm, 120);
});

test("GRBL fills complex vector geometry at 0.05 mm spacing without a segment-count false rejection", () => {
  const subdivisions = 1200;
  const topEdge = Array.from({ length: subdivisions + 1 }, (_, index) => {
    const xMm = 180 * index / subdivisions;
    const yMm = index % 2 === 0 ? 0.5 : 1;
    return `L ${xMm} ${yMm}`;
  }).join(" ");
  const plan = planGrblJob({
    widthMm: 180,
    heightMm: 120,
    layers: [{ id: "fill", operation: "fill", fillSpacingMm: 0.05 }],
    elements: [{
      id: "detailed-area",
      type: "path",
      xMm: 0,
      yMm: 0,
      widthMm: 180,
      heightMm: 120,
      pathData: `M 0 0.5 ${topEdge} L 180 120 L 0 120 Z`,
      layerId: "fill"
    }]
  }, machineSettings);

  assert.ok(plan.stats.workPathCount >= 2400);
  assert.ok(plan.stats.workPathCount < 100000);
});

test("GRBL fills closed vector paths and leaves holes unfilled", () => {
  const triangle = planGrblJob({
    widthMm: 20,
    heightMm: 20,
    layers: [{ id: "fill", operation: "fill", fillSpacingMm: 2 }],
    elements: [{
      id: "triangle",
      type: "path",
      xMm: 4,
      yMm: 5,
      widthMm: 10,
      heightMm: 10,
      pathData: "M 0 0 L 10 0 L 5 10 Z",
      layerId: "fill"
    }]
  }, machineSettings);
  const trianglePaths = triangle.paths.filter((path) => path.kind === "work");
  assert.equal(trianglePaths.length, 5);
  assert.deepEqual(trianglePaths.slice(0, 2).map((path) => path.points.map(({ xMm, yMm }) => [xMm, yMm])), [
    [[4, 5], [14, 5]],
    [[13, 7], [5, 7]]
  ]);

  const ring = planGrblJob({
    widthMm: 20,
    heightMm: 20,
    layers: [{ id: "fill", operation: "fill", fillSpacingMm: 4 }],
    elements: [{
      id: "ring",
      type: "path",
      xMm: 2,
      yMm: 2,
      widthMm: 10,
      heightMm: 10,
      pathData: "M 0 0 L 10 0 L 10 10 L 0 10 Z M 3 3 L 7 3 L 7 7 L 3 7 Z",
      layerId: "fill"
    }]
  }, machineSettings);
  const y6Segments = ring.paths.filter((path) => path.kind === "work" && path.points[0].yMm === 6);
  assert.deepEqual(y6Segments.map((path) => path.points.map(({ xMm, yMm }) => [xMm, yMm])), [
    [[12, 6], [9, 6]],
    [[5, 6], [2, 6]]
  ]);
});

test("GRBL fill closes open SVG subpaths and skips zero-area ones", () => {
  const fillJob = (pathData) => planGrblJob({
    widthMm: 20,
    heightMm: 20,
    layers: [{ id: "fill", operation: "fill" }],
    elements: [{
      id: "path",
      type: "path",
      xMm: 1,
      yMm: 1,
      widthMm: 10,
      heightMm: 10,
      pathData,
      layerId: "fill"
    }]
  }, machineSettings);
  const open = fillJob("M 0 0 L 10 0 L 10 10 L 0 10");
  assert.deepEqual(open.paths, fillJob("M 0 0 L 10 0 L 10 10 L 0 10 Z").paths);
  assert.ok(open.paths.some((path) => path.kind === "work"));
  assert.throws(() => fillJob("M 0 0 L 10 0"), /no fillable paths/);
});

test("self-intersecting fill contours retain both lobes alongside other subpaths", () => {
  const plan = planGrblJob({
    widthMm: 30, heightMm: 30,
    layers: [{ id: "fill", operation: "fill", fillSpacingMm: 1 }],
    elements: [{
      id: "bowtie", type: "path", layerId: "fill", xMm: 1, yMm: 1, widthMm: 20, heightMm: 10,
      pathData: "M0 0 L10 10 L0 10 L10 0 Z M12 0 L20 0 L20 10 L12 10 Z"
    }]
  }, machineSettings);
  const work = plan.paths.filter(({ kind }) => kind === "work");
  assert.ok(work.some(({ points }) => points[0].xMm < 11 && points[0].yMm < 6));
  assert.ok(work.some(({ points }) => points[0].xMm < 11 && points[0].yMm > 6));
  assert.ok(work.some(({ points }) => points[0].xMm >= 13));
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

test("decorative vector fills clip every work segment to the shape and around holes", () => {
  for (const algorithm of ["inset", "squares", "zigzag", "hilbert"]) {
    const input = {
      widthMm: 40, heightMm: 40,
      layers: [{ id: "fill", operation: "fill", fillSpacingMm: 2, fillAlgorithm: algorithm, powerPercent: 35 }],
      elements: [{
        id: "shape", type: "path", xMm: 5, yMm: 5, widthMm: 20, heightMm: 20,
        pathData: "M0 0 L20 0 L20 20 L0 20 Z M8 8 L12 8 L12 12 L8 12 Z", layerId: "fill"
      }]
    };
    const plan = planGrblJob(input, machineSettings);
    const work = plan.paths.filter(({ kind }) => kind === "work");
    assert.ok(work.length > 0, algorithm);
    const expected = work.flatMap(({ points }) => points);
    const actual = [];
    let modal = { motion: "G0", relative: false, feedMmPerMinute: undefined };
    for (const line of plan.gcode.trim().split("\n")) {
      const parsed = interpretGcodeLine(line, modal);
      modal = parsed.modal;
      if (parsed.motion) {
        if (parsed.motion.rapid) assert.ok(plan.gcode.includes(`M5\n${line}`), `${algorithm}: rapid must be laser-off`);
        else actual.push({ xMm: parsed.motion.x, yMm: parsed.motion.y });
      }
    }
    assert.deepEqual(actual, work.flatMap(({ points }) => points.slice(1).map(({ xMm, yMm }) => ({ xMm, yMm }))), algorithm);
    assert.match(plan.gcode, /M4 S350/);
    for (const path of work) {
      for (let index = 1; index < path.points.length; index += 1) {
        const a = path.points[index - 1], b = path.points[index];
        for (let step = 0; step <= 20; step += 1) {
          const x = a.xMm + (b.xMm - a.xMm) * step / 20;
          const y = a.yMm + (b.yMm - a.yMm) * step / 20;
          assert.ok(x >= 5 - 1e-6 && x <= 25 + 1e-6 && y >= 5 - 1e-6 && y <= 25 + 1e-6, algorithm);
          assert.ok(!(x > 13 + 1e-6 && x < 17 - 1e-6 && y > 13 + 1e-6 && y < 17 - 1e-6), algorithm);
        }
      }
    }
    assert.ok(expected.length > 1);
    const restored = parseProject(serializeProject(input));
    assert.equal(restored.layers[0].fillAlgorithm, algorithm);
    assert.equal(renderSvg(restored), renderSvg(input));
  }
});

test("decorative fills reject unsafe complexity and patterns that miss a nonempty shape", () => {
  const document = {
    widthMm: 40, heightMm: 40,
    layers: [{ id: "fill", operation: "fill", fillAlgorithm: "hilbert", fillSpacingMm: 0.001 }],
    elements: [{ id: "shape", type: "rect", xMm: 5, yMm: 5, widthMm: 20, heightMm: 20, layerId: "fill" }]
  };
  assert.throws(() => planGrblJob(document, machineSettings), { code: "grbl.patternTooComplex" });
  document.layers[0].fillSpacingMm = 1e-8;
  assert.throws(() => planGrblJob(document, machineSettings), { code: "grbl.patternPrecision" });
  document.layers[0].fillSpacingMm = 100;
  assert.throws(() => planGrblJob(document, machineSettings), { code: "grbl.patternNoCoverage" });
});

test("decorative patterns follow object rotation and relative job placement", () => {
  for (const algorithm of ["inset", "squares", "zigzag", "hilbert"]) {
    const document = {
      widthMm: 60, heightMm: 60,
      origin: { corner: "bottom-right", flipX: true },
      layers: [{ id: "fill", operation: "fill", fillAlgorithm: algorithm, fillSpacingMm: 2 }],
      elements: [{ id: "shape", type: "rect", xMm: 10, yMm: 10, widthMm: 20, heightMm: 10, rotationDeg: 90, layerId: "fill" }]
    };
    const plan = planGrblJob(document, { ...machineSettings, startFrom: "objects", startAnchor: "center" });
    const work = planToDocumentSpace(document, plan).paths.filter(({ kind }) => kind === "work");
    assert.ok(work.length > 0, algorithm);
    for (const { points } of work) for (const { xMm, yMm } of points) {
      assert.ok(xMm >= 15 - 1e-6 && xMm <= 25 + 1e-6 && yMm >= 5 - 1e-6 && yMm <= 25 + 1e-6, algorithm);
    }
    assert.match(plan.gcode, /^G21\nG91\n/);
    assert.match(plan.gcode, /G90\n$/);
  }
});

test("decorative patterns cover both lobes of a self-intersection and a separate region", () => {
  for (const algorithm of ["inset", "squares", "zigzag", "hilbert"]) {
    const plan = planGrblJob({
      widthMm: 30, heightMm: 30,
      layers: [{ id: "fill", operation: "fill", fillSpacingMm: 1, fillAlgorithm: algorithm }],
      elements: [{
        id: "shape", type: "path", layerId: "fill", xMm: 1, yMm: 1, widthMm: 20, heightMm: 10,
        pathData: "M0 0 L10 10 L0 10 L10 0 Z M12 0 L20 0 L20 10 L12 10 Z"
      }]
    }, machineSettings);
    const points = plan.paths.filter(({ kind }) => kind === "work").flatMap(({ points }) => points);
    assert.ok(points.some(({ xMm, yMm }) => xMm < 11 && yMm < 5.9), algorithm);
    assert.ok(points.some(({ xMm, yMm }) => xMm < 11 && yMm > 6.1), algorithm);
    assert.ok(points.some(({ xMm }) => xMm > 13), algorithm);
  }
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

test("nearest ordering handles objects without fill paths without losing the remaining job", () => {
  const document = {
    widthMm: 100, heightMm: 60,
    layers: [{ id: "fill", operation: "fill", fillSpacingMm: 1 }],
    elements: [
      { id: "far", type: "rect", xMm: 60, yMm: 20, widthMm: 4, heightMm: 4, layerId: "fill" },
      { id: "line", type: "path", xMm: 1, yMm: 1, widthMm: 10, heightMm: 0, pathData: "M0 0 L10 0", layerId: "fill" },
      { id: "near", type: "rect", xMm: 5, yMm: 5, widthMm: 4, heightMm: 4, layerId: "fill" }
    ]
  };
  for (const objectOrder of ["document", "center-out", "nearest"]) {
    const input = { ...document, layers: [{ ...document.layers[0], objectOrder }] };
    const plan = planGrblJob(input, machineSettings);
    const ids = [...new Set(plan.paths.filter(({ kind }) => kind === "work").map(({ elementId }) => elementId))];
    assert.deepEqual(new Set(ids), new Set(["far", "near"]));
    if (objectOrder === "nearest") assert.deepEqual(ids, ["near", "far"]);
    assert.ok(jobReferencePoints(input, machineSettings)?.start);
    assert.equal(createDocument(input).elements.length, 3);
  }
  const empty = { ...document, layers: [{ ...document.layers[0], objectOrder: "nearest" }], elements: [document.elements[1]] };
  assert.throws(() => planGrblJob(empty, machineSettings), /no fillable paths/);
});

test("layer fill and object-order algorithms reject unknown values", () => {
  assert.throws(() => createDocument({ layers: [{ id: "bad", fillAlgorithm: "spiral" }] }), /unsupported fill algorithm/);
  assert.throws(() => createDocument({ layers: [{ id: "bad", objectOrder: "random" }] }), /unsupported object order/);
});
