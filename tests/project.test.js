import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDocument } from "../src/core/document.js";
import { parseProject, serializeProject } from "../src/core/project.js";
import { convertProjectEnvelope, CURRENT_PROJECT_VERSION } from "../src/core/project-conversions.js";
import { renderSvg } from "../src/core/document.js";

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
  assert.equal(JSON.parse(serialized).version, CURRENT_PROJECT_VERSION);
  assert.equal(JSON.parse(serialized).units, "mm");
});

test("version 1 editable projects migrate to version 2 without visual or model loss", async () => {
  const legacySource = await readFile(new URL("./fixtures/project-v1.json", import.meta.url), "utf8");
  const legacyEnvelope = JSON.parse(legacySource);
  const convertedEnvelope = convertProjectEnvelope(legacyEnvelope);
  const expectedDocument = createDocument(legacyEnvelope.document);
  const convertedDocument = parseProject(legacySource);
  const serializedAgain = JSON.parse(serializeProject(convertedDocument));

  assert.equal(convertedEnvelope.version, 2);
  assert.equal(convertedEnvelope.units, "mm");
  assert.deepEqual(convertedDocument, expectedDocument);
  assert.equal(renderSvg(convertedDocument), renderSvg(expectedDocument));
  assert.equal(serializedAgain.version, 2);
  assert.equal(serializedAgain.units, "mm");
});

test("project conversion rejects future versions instead of rewriting unknown data", () => {
  assert.throws(() => convertProjectEnvelope({
    format: "commburn-project",
    version: CURRENT_PROJECT_VERSION + 1,
    units: "mm",
    document: {}
  }), { code: "project.unsupportedFormat" });
});

test("editable project loading rejects malformed, unknown, and invalid documents", () => {
  assert.throws(() => parseProject("{"), (error) => {
    assert.ok(error instanceof TypeError);
    assert.equal(error.code, "project.invalidJson");
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
  assert.throws(() => parseProject(JSON.stringify({ format: "other", version: 1, document: {} })), /Unknown CommBurn project/);
  assert.throws(() => parseProject(JSON.stringify({
    format: "commburn-project",
    version: 1,
    document: { widthMm: 0 }
  })), /greater than zero/);
  assert.throws(() => parseProject(null), /must be a JSON string/);
});
