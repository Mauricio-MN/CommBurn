import test from "node:test";
import assert from "node:assert/strict";
import { SHORTCUTS } from "../src/ui/shortcuts.js";
import { TOOLS } from "../src/ui/toolbar.js";
import { planGrblJob } from "../src/core/document.js";
import {
  createPresentationDocument,
  createPresentationSimulationDocument
} from "../src/ui/presentation.js";

test("each editor tool has one documented and keyboard-accessible shortcut", () => {
  for (const tool of TOOLS) {
    assert.ok(SHORTCUTS.some((shortcut) => shortcut.keys === tool.key), `${tool.label} must be listed in shortcuts`);
    assert.ok(tool.description.length > 0, `${tool.label} must provide a description`);
  }
  assert.equal(new Set(TOOLS.map((tool) => tool.key)).size, TOOLS.length);
});

test("copy and paste shortcuts are documented for cross-layer object transfer", () => {
  assert.ok(SHORTCUTS.some(({ keys }) => keys === "Ctrl+C"));
  assert.ok(SHORTCUTS.some(({ keys }) => keys === "Ctrl+V"));
});

test("presentation simulation keeps only untransformed rectangles supported by GRBL", () => {
  const source = createPresentationDocument();
  const documentModel = {
    ...source,
    elements: [
      { id: "label", type: "text", text: "CommBurn", xMm: 10, yMm: 20, fontSizeMm: 8, layerId: source.layers[0].id },
      { id: "frame", type: "rect", xMm: 20, yMm: 20, widthMm: 80, heightMm: 40, layerId: source.layers[0].id },
      { id: "rotated", type: "rect", xMm: 25, yMm: 25, widthMm: 5, heightMm: 5, rotationDeg: 20, layerId: source.layers[0].id }
    ]
  };

  const simulationDocument = createPresentationSimulationDocument(documentModel);
  const plan = planGrblJob(simulationDocument, { maxSpindleSpeed: 1000 });

  assert.deepEqual(simulationDocument.elements.map(({ id }) => id), ["frame"]);
  assert.ok(plan.paths.some(({ kind }) => kind === "work"));
  assert.ok(plan.gcode.includes("G1"));
});

test("presentation starts with an empty metric document and a safe unlocked demo layer", () => {
  const documentModel = createPresentationDocument();

  assert.equal(documentModel.widthMm, 180);
  assert.equal(documentModel.heightMm, 120);
  assert.deepEqual(documentModel.elements, []);
  assert.equal(documentModel.layers[0].operation, "engrave");
  assert.equal(documentModel.layers[0].locked, false);
});
