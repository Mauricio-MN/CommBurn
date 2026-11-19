import test from "node:test";
import assert from "node:assert/strict";
import { CanvasController } from "../src/ui/canvas-controller.js";

test("axis inversion settings never reverse direct object movement on the stage", () => {
  for (const origin of [
    { corner: "top-left", flipX: true, flipY: true },
    { corner: "bottom-right", flipX: false, flipY: false }
  ]) {
    let selectedIds = [];
    let updates;
    const element = { id: "box", type: "rect", xMm: 10, yMm: 20, widthMm: 5, heightMm: 5, layerId: "layer" };
    const handlers = new Map();
    const svg = {
      querySelector: () => ({}),
      addEventListener: (name, handler) => handlers.set(name, handler),
      createSVGPoint: () => ({
        x: 0,
        y: 0,
        matrixTransform() { return { x: this.x, y: this.y }; }
      }),
      getScreenCTM: () => ({ inverse: () => ({}) }),
      setPointerCapture() {}
    };
    const callbacks = {
      getTool: () => "move",
      getDocument: () => ({
        origin,
        elements: [element],
        layers: [{ id: "layer", locked: false }]
      }),
      getSelectedIds: () => selectedIds,
      select: (id) => { selectedIds = [id]; },
      updateMany: (changes) => { updates = changes; },
      notify() {},
      commit() {}
    };
    const controller = new CanvasController(svg, callbacks);
    const event = (clientX, clientY) => ({
      button: 0,
      pointerId: 1,
      clientX,
      clientY,
      shiftKey: false,
      target: { closest: () => ({ dataset: { id: "box" } }) },
      preventDefault() {}
    });

    controller.onPointerDown(event(40, 50));
    controller.onPointerMove(event(47, 44));
    assert.deepEqual(updates, [{ id: "box", patch: { xMm: 17, yMm: 14 } }]);
  }
});
