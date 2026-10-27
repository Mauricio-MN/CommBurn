import test from "node:test";
import assert from "node:assert/strict";
import { createDocument } from "../src/core/document.js";
import { parseProject, serializeProject } from "../src/core/project.js";

test("editable projects round-trip document dimensions, origin, layers, and objects", () => {
  const document = createDocument({
    widthMm: 180,
    heightMm: 120,
    origin: { corner: "bottom-right", flipX: true, flipY: false },
    layers: [{
      id: "fill",
      name: "Preenchimento",
      operation: "fill",
      fillSpacingMm: 0.4,
      fillAlgorithm: "crosshatch",
      objectOrder: "center-out",
      color: "#32a77f"
    }],
    elements: [{ id: "frame", type: "rect", xMm: 10, yMm: 12, widthMm: 40, heightMm: 30, layerId: "fill" }]
  });
  const serialized = serializeProject(document);
  const parsed = parseProject(serialized);

  assert.deepEqual(parsed, document);
  assert.equal(JSON.parse(serialized).format, "commburn-project");
  assert.equal(JSON.parse(serialized).version, 1);
});

test("editable project loading rejects malformed, unknown, and invalid documents", () => {
  assert.throws(() => parseProject("{"), /valid JSON/);
  assert.throws(() => parseProject(JSON.stringify({ format: "other", version: 1, document: {} })), /Unknown CommBurn project/);
  assert.throws(() => parseProject(JSON.stringify({
    format: "commburn-project",
    version: 1,
    document: { widthMm: 0 }
  })), /greater than zero/);
  assert.throws(() => parseProject(null), /must be a JSON string/);
});
