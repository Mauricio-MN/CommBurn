import test from "node:test";
import assert from "node:assert/strict";
import { computeAdjustedUpdates } from "../src/core/property-adjust.js";

const elements = [
  { id: "a", type: "rect", xMm: 10, yMm: 5, widthMm: 20, heightMm: 0.5, rotationDeg: 0 },
  { id: "b", type: "line", xMm: 40, yMm: 8, widthMm: 0, heightMm: 12, rotationDeg: 15 }
];

test("set mode links every selected element to the same value", () => {
  const updates = computeAdjustedUpdates(elements, ["a", "b"], { property: "xMm", mode: "set", value: 30 });
  assert.deepEqual(updates, [
    { id: "a", patch: { xMm: 30 } },
    { id: "b", patch: { xMm: 30 } }
  ]);
});

test("relative mode adds the delta to each element's own value", () => {
  const updates = computeAdjustedUpdates(elements, ["a", "b"], { property: "rotationDeg", mode: "relative", value: -5 });
  assert.deepEqual(updates, [
    { id: "a", patch: { rotationDeg: -5 } },
    { id: "b", patch: { rotationDeg: 10 } }
  ]);
});

test("rect and ellipse dimensions never drop below 0.1 mm, lines may reach zero", () => {
  const rect = computeAdjustedUpdates(elements, ["a"], { property: "heightMm", mode: "relative", value: -2 });
  assert.equal(rect[0].patch.heightMm, 0.1);
  const line = computeAdjustedUpdates(elements, ["b"], { property: "widthMm", mode: "relative", value: -3 });
  assert.equal(line[0].patch.widthMm, 0);
});

test("rejects unknown properties, modes and non-finite values", () => {
  assert.throws(() => computeAdjustedUpdates(elements, ["a"], { property: "text", mode: "set", value: 1 }), RangeError);
  assert.throws(() => computeAdjustedUpdates(elements, ["a"], { property: "xMm", mode: "multiply", value: 1 }), RangeError);
  assert.throws(() => computeAdjustedUpdates(elements, ["a"], { property: "xMm", mode: "set", value: Number.NaN }), RangeError);
});
