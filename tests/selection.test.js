import test from "node:test";
import assert from "node:assert/strict";
import { selectMany, selectOne } from "../src/ui/selection.js";

test("single selection replaces, adds, and toggles selected ids", () => {
  assert.deepEqual(selectOne(["a"], "b"), ["b"]);
  assert.deepEqual(selectOne(["a"], "b", { additive: true }), ["a", "b"]);
  assert.deepEqual(selectOne(["a", "b"], "a", { additive: true, toggle: true }), ["b"]);
  assert.deepEqual(selectOne(["a"], "a", { keepExisting: true }), ["a"]);
});

test("marquee selection replaces or extends selection without duplicates", () => {
  assert.deepEqual(selectMany(["a"], ["b", "b", "c"]), ["b", "c"]);
  assert.deepEqual(selectMany(["a"], ["b", "a"], { additive: true }), ["a", "b"]);
});
