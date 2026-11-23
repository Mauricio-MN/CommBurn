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
      previewMove() {},
      clearMovePreview() {},
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

test("pointer moves within one frame preview only the latest position, then commit once", () => {
  const frames = [];
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const updates = [];
    const previews = [];
    let cleared = 0;
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
      previewMove: (ids, dx, dy) => previews.push({ ids, dx, dy }),
      clearMovePreview: () => { cleared += 1; },
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
    assert.equal(previews.length, 0);
    assert.equal(frames.length, 1);
    frames[0]();
    assert.deepEqual(previews, [{ ids: ["box"], dx: 7, dy: -6 }]);
    assert.equal(updates.length, 0);
    controller.onPointerUp(event(47, 44));
    assert.equal(cleared, 1);
    assert.deepEqual(updates, [[{ id: "box", patch: { xMm: 17, yMm: 14 } }]]);
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

test("cancelling a move restores the preview without committing a model update", () => {
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    const element = { id: "box", type: "rect", xMm: 10, yMm: 20, widthMm: 5, heightMm: 5, layerId: "layer" };
    const svg = {
      querySelector: () => ({}), addEventListener() {}, setPointerCapture() {},
      createSVGPoint: () => ({ matrixTransform() { return { x: this.x, y: this.y }; } }),
      getScreenCTM: () => ({ inverse: () => ({}) })
    };
    let cleared, updates = 0, commits = 0;
    const controller = new CanvasController(svg, {
      getTool: () => "move", getDocument: () => ({ elements: [element], layers: [{ id: "layer" }] }),
      getSelectedIds: () => ["box"], select() {}, previewMove() {},
      clearMovePreview: (options) => { cleared = options; },
      updateMany: () => { updates++; }, commit: () => { commits++; }
    });
    const event = { button: 0, pointerId: 1, clientX: 10, clientY: 10, shiftKey: false,
      target: { closest: () => ({ dataset: { id: "box" } }) }, preventDefault() {} };
    controller.onPointerDown(event);
    controller.onPointerMove(event);
    controller.onPointerUp(event, true);
    assert.deepEqual(cleared, { cancelled: true });
    assert.equal(updates, 0);
    assert.equal(commits, 0);
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});


test("a drag keeps the job markers on the moved object without rebuilding the model mid-drag", async () => {
  const { createDocument, jobReferencePoints } = await import("../src/core/document.js");
  const frames = [];
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    let elements = [{ id: "box", type: "rect", xMm: 10, yMm: 10, widthMm: 20, heightMm: 10, layerId: "layer" }];
    const settings = { feedMmPerMinute: 300, maxSpindleSpeed: 1000 };
    const markers = (items) => jobReferencePoints(createDocument({ widthMm: 100, heightMm: 80, layers: [{ id: "layer", locked: false }], elements: items }), settings);
    const before = markers(elements);
    const previews = [];
    let updates = null;
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
      getDocument: () => createDocument({ widthMm: 100, heightMm: 80, layers: [{ id: "layer", locked: false }], elements }),
      getSelectedIds: () => ["box"],
      select() {},
      previewMove: (ids, dx, dy) => previews.push({ dx, dy }),
      clearMovePreview() {},
      updateMany: (changes) => { updates = changes; },
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
    controller.onPointerMove(event(45, 52));
    controller.onPointerMove(event(50, 58));
    frames.shift()();
    assert.equal(previews.length, 1);
    assert.equal(updates, null, "the model must not be rebuilt while dragging");

    controller.onPointerUp(event(50, 58));
    assert.deepEqual(updates, [{ id: "box", patch: { xMm: 20, yMm: 18 } }]);

    elements = elements.map((element) => ({ ...element, ...updates[0].patch }));
    const after = markers(elements);
    const dx = 10, dy = 8;
    for (const point of ["start", "end"]) {
      assert.ok(Math.abs(after[point].xMm - (before[point].xMm + dx)) < 1e-6, `${point} X follows the object`);
      assert.ok(Math.abs(after[point].yMm - (before[point].yMm + dy)) < 1e-6, `${point} Y follows the object`);
    }
    assert.deepEqual(after.origin, before.origin, "the origin stays on the machine");
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});
