import test from "node:test";
import assert from "node:assert/strict";
import { CanvasController } from "../src/ui/canvas-controller.js";

test("axis inversion settings never reverse direct object movement on the stage", () => {
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    checkAxisInversionMoves();
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

function checkAxisInversionMoves() {
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
    controller.onPointerUp(event(47, 44));
    assert.deepEqual(updates, [{ id: "box", patch: { xMm: 17, yMm: 14 } }]);
  }
}

test("pointer moves within one frame apply only the latest position", () => {
  const frames = [];
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const updates = [];
    const element = { id: "box", type: "rect", xMm: 10, yMm: 20, widthMm: 5, heightMm: 5, layerId: "layer" };
    const handlers = new Map();
    const svg = {
      querySelector: () => ({}),
      addEventListener: (name, handler) => handlers.set(name, handler),
      createSVGPoint: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }),
      getScreenCTM: () => ({ inverse: () => ({}) }),
      setPointerCapture() {}
    };
    const callbacks = {
      getTool: () => "move",
      getDocument: () => ({ origin: { corner: "bottom-left" }, elements: [element], layers: [{ id: "layer", locked: false }] }),
      getSelectedIds: () => ["box"],
      select() {},
      updateMany: (changes) => updates.push(changes),
      notify() {},
      commit() {}
    };
    const controller = new CanvasController(svg, callbacks);
    const event = (clientX, clientY) => ({
      button: 0, pointerId: 1, clientX, clientY, shiftKey: false,
      target: { closest: () => ({ dataset: { id: "box" } }) },
      preventDefault() {}
    });
    controller.onPointerDown(event(40, 50));
    controller.onPointerMove(event(41, 51));
    controller.onPointerMove(event(44, 53));
    controller.onPointerMove(event(47, 44));
    assert.equal(updates.length, 0);
    assert.equal(frames.length, 1);
    frames[0]();
    assert.deepEqual(updates, [[{ id: "box", patch: { xMm: 17, yMm: 14 } }]]);
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});
