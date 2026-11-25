import test from "node:test";
import assert from "node:assert/strict";
import { pathAspectRatio, restoreProportionPatch } from "../src/core/aspect.js";

test("a path reports the proportions of its own geometry", () => {
  assert.equal(pathAspectRatio("M0 0 L20 0 L20 10 L0 10 Z"), 2);
  assert.equal(pathAspectRatio("M5 5 L15 5 L15 35 L5 35 Z"), 1 / 3);
  assert.equal(pathAspectRatio("M0 0 L10 0"), null);
});

test("restoring proportions keeps the width and recomputes the height", () => {
  assert.deepEqual(restoreProportionPatch({ id: "p", widthMm: 30, heightMm: 99 }, 2), { heightMm: 15 });
  for (const ratio of [null, 0, NaN, Infinity]) {
    assert.throws(() => restoreProportionPatch({ id: "p", widthMm: 30 }, ratio), RangeError);
  }
});
