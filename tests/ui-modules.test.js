import test from "node:test";
import assert from "node:assert/strict";
import { SHORTCUTS } from "../src/ui/shortcuts.js";
import { TOOLS } from "../src/ui/toolbar.js";

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
