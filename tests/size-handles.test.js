import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CanvasController } from "../src/ui/canvas-controller.js";
import { createDocument } from "../src/core/document.js";
import { renderSizeHandles, resizeBounds, scaleElementPatch } from "../src/ui/size-handles.js";

const box = { left: 10, top: 20, right: 30, bottom: 60 };

test("edge handles stretch one axis and keep the opposite edge fixed", () => {
  const east = resizeBounds(box, "e", { x: 50, y: 999 });
  assert.deepEqual(east.bounds, { left: 10, top: 20, right: 50, bottom: 60 });
  assert.equal(east.sx, 2);
  assert.equal(east.sy, 1);
  const north = resizeBounds(box, "n", { x: 999, y: 0 });
  assert.deepEqual(north.bounds, { left: 10, top: 0, right: 30, bottom: 60 });
  assert.equal(north.sx, 1);
  assert.equal(north.sy, 1.5);
  const west = resizeBounds(box, "w", { x: 0, y: 999 });
  assert.deepEqual(west.bounds, { left: 0, top: 20, right: 30, bottom: 60 });
});

test("corner handles keep proportions when asked and stretch freely otherwise", () => {
  const proportional = resizeBounds(box, "se", { x: 50, y: 70 }, { proportional: true });
  // Width asks for 2x and height for 1.25x: the larger factor wins and the north-west corner stays put.
  assert.equal(proportional.sx, 2);
  assert.equal(proportional.sy, 2);
  assert.deepEqual(proportional.bounds, { left: 10, top: 20, right: 50, bottom: 100 });
  const free = resizeBounds(box, "se", { x: 50, y: 70 });
  assert.deepEqual(free.bounds, { left: 10, top: 20, right: 50, bottom: 70 });
  assert.equal(free.sx, 2);
  assert.equal(free.sy, 1.25);
  const northWest = resizeBounds(box, "nw", { x: 0, y: 0 });
  assert.deepEqual(northWest.bounds, { left: 0, top: 0, right: 30, bottom: 60 });
});

test("resizing never goes below 0.1 mm or flips, and zero-size axes are left alone", () => {
  const collapsed = resizeBounds(box, "e", { x: -100, y: 0 });
  assert.ok(Math.abs(collapsed.bounds.right - collapsed.bounds.left - 0.1) < 1e-9);
  const line = { left: 0, top: 5, right: 20, bottom: 5 };
  const stretched = resizeBounds(line, "se", { x: 40, y: 50 });
  assert.deepEqual(stretched.bounds, { left: 0, top: 5, right: 40, bottom: 5 });
  assert.equal(stretched.sy, 1);
  assert.throws(() => resizeBounds(box, "x", { x: 0, y: 0 }), /desconhecida/);
});

test("elements follow the selection box; images stretch and text scales uniformly", () => {
  const { bounds, sx, sy } = resizeBounds(box, "se", { x: 50, y: 100 });
  const rect = { id: "r", type: "rect", xMm: 20, yMm: 40, widthMm: 10, heightMm: 20 };
  assert.deepEqual(scaleElementPatch(rect, box, bounds, sx, sy), { xMm: 30, yMm: 60, widthMm: 20, heightMm: 40 });
  const image = { id: "i", type: "image", xMm: 10, yMm: 20, widthMm: 20, heightMm: 40, preserveAspectRatio: "xMidYMid meet" };
  assert.deepEqual(scaleElementPatch(image, box, bounds, sx, sy), {
    xMm: 10, yMm: 20, widthMm: 40, heightMm: 80, preserveAspectRatio: "none"
  });
  const text = { id: "t", type: "text", xMm: 10, yMm: 30, fontSizeMm: 10 };
  const textBox = { left: 10, top: 20, right: 20, bottom: 30 };
  const wide = resizeBounds(textBox, "e", { x: 30, y: 0 });
  const patch = scaleElementPatch(text, textBox, wide.bounds, wide.sx, wide.sy);
  assert.equal(patch.fontSizeMm, 20);
  assert.equal(patch.xMm, 10);
  assert.equal(patch.yMm, 40);
});

test("an image patch from the size tool is accepted by the document model", () => {
  const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const image = {
    id: "i", type: "image", xMm: 0, yMm: 0, widthMm: 10, heightMm: 10, imageDataUri: dataUri,
    preserveAspectRatio: "xMidYMid meet", layerId: "L1"
  };
  const documentModel = createDocument({ widthMm: 100, heightMm: 100, layers: [{ id: "L1", name: "L1" }], elements: [image] });
  const { bounds, sx, sy } = resizeBounds({ left: 0, top: 0, right: 10, bottom: 10 }, "e", { x: 30, y: 0 });
  const patch = scaleElementPatch(documentModel.elements[0], { left: 0, top: 0, right: 10, bottom: 10 }, bounds, sx, sy);
  const resized = createDocument({ ...documentModel, elements: [{ ...documentModel.elements[0], ...patch }] });
  assert.equal(resized.elements[0].widthMm, 30);
  assert.equal(resized.elements[0].heightMm, 10);
  assert.equal(resized.elements[0].preserveAspectRatio, "none");
});

test("the handle layer draws a box, four edge strips and eight grips sized in screen pixels", () => {
  const created = [];
  globalThis.document = {
    createElementNS: () => {
      const node = { attributes: new Map(), setAttribute(name, value) { this.attributes.set(name, value); } };
      created.push(node);
      return node;
    }
  };
  try {
    const group = { children: [], replaceChildren() { this.children = []; }, append(...nodes) { this.children.push(...nodes); } };
    renderSizeHandles(group, null, 1);
    assert.equal(group.children.length, 0);
    renderSizeHandles(group, box, 0.5);
    const handles = group.children.map((node) => node.attributes.get("data-size-handle")).filter(Boolean);
    assert.equal(group.children.length, 13);
    assert.deepEqual([...handles].sort(), ["e", "e", "n", "n", "ne", "nw", "s", "s", "se", "sw", "w", "w"]);
    const grip = group.children.find((node) => node.attributes.get("class") === "size-grip" && node.attributes.get("data-size-handle") === "se");
    assert.equal(grip.attributes.get("width"), "4.5");
    assert.equal(grip.attributes.get("x"), String(30 - 2.25));
  } finally {
    delete globalThis.document;
  }
});

test("dragging a handle resizes the selection and commits once; Shift frees the corner", () => {
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    for (const { shiftKey, expected } of [
      { shiftKey: false, expected: { xMm: 10, yMm: 20, widthMm: 40, heightMm: 80 } },
      { shiftKey: true, expected: { xMm: 10, yMm: 20, widthMm: 40, heightMm: 50 } }
    ]) {
      const updates = [];
      let commits = 0;
      const element = { id: "box", type: "rect", xMm: 10, yMm: 20, widthMm: 20, heightMm: 40, layerId: "layer" };
      const handlers = new Map();
      const svg = {
        querySelector: () => ({}),
        addEventListener: (name, handler) => handlers.set(name, handler),
        createSVGPoint: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }),
        getScreenCTM: () => ({ inverse: () => ({}) }),
        setPointerCapture() {}
      };
      const controller = new CanvasController(svg, {
        getTool: () => "size",
        getDocument: () => ({ elements: [element], layers: [{ id: "layer", locked: false }] }),
        getSelectedIds: () => ["box"],
        updateMany: (changes) => { updates.push(changes); },
        notify() {},
        commit: () => { commits += 1; }
      });
      const event = (clientX, clientY, shift = shiftKey) => ({
        button: 0,
        pointerId: 1,
        clientX,
        clientY,
        shiftKey: shift,
        target: { closest: (selector) => (selector === "[data-size-handle]" ? { dataset: { sizeHandle: "se" } } : null) },
        preventDefault() {}
      });
      controller.onPointerDown(event(30, 60));
      controller.onPointerMove(event(50, 70));
      controller.onPointerUp(event(50, 70));
      assert.equal(updates.length, 1);
      assert.deepEqual(updates[0], [{ id: "box", patch: expected }]);
      assert.equal(commits, 1);
    }
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

test("handles are ignored outside the size tool and on locked layers", () => {
  const notices = [];
  const element = { id: "box", type: "rect", xMm: 0, yMm: 0, widthMm: 5, heightMm: 5, layerId: "layer" };
  const svg = {
    querySelector: () => ({}),
    addEventListener() {},
    createSVGPoint: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }),
    getScreenCTM: () => ({ inverse: () => ({}) }),
    setPointerCapture() {}
  };
  const event = {
    button: 0, pointerId: 1, clientX: 0, clientY: 0, shiftKey: false,
    target: { closest: (selector) => (selector === "[data-size-handle]" ? { dataset: { sizeHandle: "e" } } : null) },
    preventDefault() {}
  };
  const make = (tool, locked) => new CanvasController(svg, {
    getTool: () => tool,
    getDocument: () => ({ elements: [element], layers: [{ id: "layer", locked }] }),
    getSelectedIds: () => ["box"],
    deselect() {},
    notify: (message) => notices.push(message)
  });
  const other = make("move", false);
  other.onPointerDown(event);
  assert.equal(other.interaction, null);
  const locked = make("size", true);
  locked.onPointerDown(event);
  assert.equal(locked.interaction, null);
  assert.equal(notices.length, 1);
});

test("the editor draws the handle layer, creates stretching images and stretches them from the inspector", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<g id="size-handles"><\/g>/);
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app, /type: "image",[\s\S]{0,120}preserveAspectRatio: "none"/);
  assert.match(app, /current\?\.type === "image" && \["widthMm", "heightMm"\]\.includes\(property\)\) patch\.preserveAspectRatio = "none"/);
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.size-grip \{/);
  assert.match(css, /data-size-handle="ne"\], \.artboard \[data-size-handle="sw"\] \{ cursor: nesw-resize/);
});
