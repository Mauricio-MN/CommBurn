import test from "node:test";
import assert from "node:assert/strict";
import { DocumentHistory } from "../src/ui/history.js";

test("document history supports undo, redo, and replacing the redo branch", () => {
  const history = new DocumentHistory({ widthMm: 100, elements: [] });
  history.push({ widthMm: 100, elements: [{ id: "a" }] });
  history.push({ widthMm: 100, elements: [{ id: "a" }, { id: "b" }] });

  assert.deepEqual(history.undo(), { widthMm: 100, elements: [{ id: "a" }] });
  history.push({ widthMm: 100, elements: [{ id: "c" }] });
  assert.deepEqual(history.redo(), null);
  assert.deepEqual(history.undo(), { widthMm: 100, elements: [{ id: "a" }] });
  assert.deepEqual(history.undo(), { widthMm: 100, elements: [] });
  assert.deepEqual(history.undo(), null);
});

test("replacing a project resets history to the imported snapshot", () => {
  const history = new DocumentHistory({ widthMm: 100, elements: [] });
  history.push({ widthMm: 100, elements: [{ id: "old" }] });
  const imported = { widthMm: 200, elements: [{ id: "new" }] };
  history.reset(imported);

  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);
  history.push({ widthMm: 200, elements: [{ id: "new" }, { id: "later" }] });
  assert.deepEqual(history.undo(), imported);
});
