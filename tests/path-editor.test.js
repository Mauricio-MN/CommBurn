import test from "node:test";
import assert from "node:assert/strict";
import { SVGPathData } from "../node_modules/svg-pathdata/lib/SVGPathData.module.js";
import { encodeEditablePath, normalizeEditablePath } from "../src/ui/path-editor.js";

test("path editor normalizes relative, arc, and smooth commands into editable cubic anchors", () => {
  const commands = normalizeEditablePath("m 1 1 q 2 3 4 0 t 4 0 a 2 2 0 0 1 4 0 z");
  assert.ok(commands.some((command) => command.type === SVGPathData.CURVE_TO));
  assert.ok(commands.every((command) => [SVGPathData.MOVE_TO, SVGPathData.LINE_TO, SVGPathData.CURVE_TO].includes(command.type)));
  assert.doesNotThrow(() => new SVGPathData(encodeEditablePath(commands)));
});

test("path editor rejects malformed or excessively complex path data", () => {
  assert.throws(() => normalizeEditablePath("invalid"));
});
