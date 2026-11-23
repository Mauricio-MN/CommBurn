import test from "node:test";
import assert from "node:assert/strict";
import { RasterPreview, rasterDimensions, selectionRuns } from "../src/ui/raster-preview.js";

function fakeNode(id, layer = "a") {
  const attributes = new Map();
  const classes = new Set();
  return {
    dataset: { id, layerId: layer },
    style: { visibility: "" },
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    before(image) { image.insertedBefore = id; },
    remove() { this.removed = true; },
    addEventListener() {}
  };
}

function setup(nodes, render) {
  const oldDocument = globalThis.document;
  globalThis.document = { createElementNS: () => fakeNode("image") };
  const objects = {
    children: nodes,
    before(image) { image.attached = true; image.behindObjects = true; },
    after(image) { image.attached = true; },
    getBoundingClientRect() { return {}; }
  };
  const artboard = fakeNode("artboard");
  const preview = new RasterPreview(artboard, objects, {
    makeSnapshot: (_artboard, group) => ({
      source: group.map((node) => `${node.dataset.id}:${node.getAttribute("transform") ?? ""}`).join(","),
      x: 2, y: 3, width: 10, height: 5, pixelWidth: 100, pixelHeight: 50
    }),
    render,
    selectionGlow: () => fakeNode("defs")
  });
  return { preview, restore: () => { globalThis.document = oldDocument; } };
}

test("raster selection preserves contiguous drawing order and caps image size", () => {
  const nodes = ["a", "b", "c", "d"].map((id) => fakeNode(id));
  assert.deepEqual(selectionRuns(nodes, ["a", "c", "d"]).map((run) => run.map((node) => node.dataset.id)), [["a"], ["c", "d"]]);
  const size = rasterDimensions(10000, 5000);
  assert.ok(size.width <= 4096 && size.width * size.height <= 4_000_000);
  assert.ok(Math.abs(size.width / size.height - 2) < 0.01);
  assert.throws(() => rasterDimensions(0, 100), RangeError);
});

test("large selections use one glow and restore individual filters when cleared", async () => {
  const nodes = Array.from({ length: 25 }, (_, index) => fakeNode(String(index)));
  const { preview, restore } = setup(nodes, async () => "data:image/png;base64,abc");
  try {
    await preview.showSelection(nodes.map((node) => node.dataset.id));
    assert.ok(preview.artboard.classList.contains("rasterized-selection"));
    assert.ok(preview.selectionImage.attached);
    assert.ok(preview.selectionImage.behindObjects);
    assert.equal(preview.selectionImage.getAttribute("href"), "data:image/png;base64,abc");
    const image = preview.selectionImage;
    preview.clearSelection();
    assert.equal(image.removed, true);
    assert.equal(preview.artboard.classList.contains("rasterized-selection"), false);
    await preview.showSelection(["0"]);
    assert.equal(preview.selectionImage, null);
  } finally { restore(); }
});

test("obsolete selection images cannot reappear after deselect", async () => {
  const nodes = Array.from({ length: 20 }, (_, index) => fakeNode(String(index)));
  let resolveRender;
  const { preview, restore } = setup(nodes, () => new Promise((resolve) => { resolveRender = resolve; }));
  try {
    const pending = preview.showSelection(nodes.map((node) => node.dataset.id));
    preview.clearSelection();
    resolveRender("data:image/png;base64,abc");
    await pending;
    assert.equal(preview.selectionImage, null);
    assert.equal(preview.artboard.classList.contains("rasterized-selection"), false);
  } finally { restore(); }
});

test("a pending selection glow cannot reappear during a drag", async () => {
  const nodes = Array.from({ length: 20 }, (_, index) => fakeNode(String(index)));
  let resolveRender;
  const { preview, restore } = setup(nodes, () => new Promise((resolve) => { resolveRender = resolve; }));
  try {
    const ids = nodes.map((node) => node.dataset.id);
    const pending = preview.showSelection(ids);
    preview.preview(ids, 2, 3);
    resolveRender("data:image/png;base64,abc");
    await pending;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(preview.selectionImage, null);
    assert.equal(preview.move.images.length, 1);
    preview.finish({ cancelled: true });
    await preview.showSelection(ids);
    assert.ok(preview.selectionImage);
  } finally { restore(); }
});

test("selection glow failures restore vector filters", async () => {
  const nodes = Array.from({ length: 20 }, (_, index) => fakeNode(String(index)));
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  const { preview, restore } = setup(nodes, async () => { throw new Error("unavailable"); });
  try {
    await preview.showSelection(nodes.map((node) => node.dataset.id));
    assert.equal(preview.artboard.classList.contains("rasterized-selection"), false);
    assert.equal(preview.selectionImage, null);
    assert.equal(errors.length, 1);
  } finally {
    console.error = originalError;
    restore();
  }
});

test("selection glow preserves missing-font warnings and falls back for page fonts", async () => {
  const nodes = Array.from({ length: 22 }, (_, index) => fakeNode(String(index)));
  nodes[0].classList.add("missing-font");
  const { preview, restore } = setup(nodes, async () => "data:image/png;base64,abc");
  try {
    const ids = nodes.map((node) => node.dataset.id);
    await preview.showSelection(ids);
    assert.ok(preview.selectionImage);
    assert.ok(nodes[0].classList.contains("missing-font"));
    nodes[1].localName = "text";
    nodes[1].setAttribute("font-family", "CommBurn Sans");
    await preview.showSelection(ids);
    assert.equal(preview.selectionImage, null);
    assert.equal(preview.artboard.classList.contains("rasterized-selection"), false);
  } finally { restore(); }
});

test("raster bounds include wide strokes beyond SVG geometry bounds", async () => {
  const saved = { document: globalThis.document, window: globalThis.window, getComputedStyle: globalThis.getComputedStyle, XMLSerializer: globalThis.XMLSerializer };
  const matrix = { a: 1, b: 0, c: 0, d: 1, inverse() { return this; } };
  const artboard = {
    getScreenCTM: () => matrix,
    createSVGPoint: () => ({ matrixTransform() { return { x: this.x, y: this.y }; } })
  };
  const node = fakeNode("wide");
  node.getBoundingClientRect = () => ({ left: 0, top: 0, right: 20, bottom: 10 });
  node.getScreenCTM = () => matrix;
  node.cloneNode = () => fakeNode("clone");
  globalThis.document = { createElementNS: () => ({ ...fakeNode("generated"), append() {} }) };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.getComputedStyle = () => ({ stroke: "red", strokeWidth: "10px" });
  globalThis.XMLSerializer = class { serializeToString() { return "svg"; } };
  try {
    const preview = new RasterPreview(artboard, {}, { render: async () => "data:image/png;base64,abc" });
    const image = await preview.imageFor([node]);
    assert.equal(image.getAttribute("x"), -22);
    assert.equal(image.getAttribute("y"), -22);
    assert.equal(image.getAttribute("width"), 64);
    assert.equal(image.getAttribute("height"), 54);
  } finally {
    Object.assign(globalThis, saved);
  }
});

test("large drag moves raster runs without changing vectors until drop", async () => {
  const nodes = Array.from({ length: 22 }, (_, index) => fakeNode(String(index)));
  const { preview, restore } = setup(nodes, async () => "data:image/png;base64,abc");
  try {
    nodes[0].setAttribute("transform", "rotate(10)");
    const ids = nodes.filter((_, index) => index !== 10).map((node) => node.dataset.id);
    preview.preview(ids, 2, 3);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(preview.move.images.length, 2);
    assert.deepEqual(preview.move.images.map((image) => image.insertedBefore), ["0", "11"]);
    assert.equal(nodes[0].style.visibility, "hidden");
    assert.equal(nodes[10].style.visibility, "");
    preview.preview(ids, 8, 9);
    assert.equal(preview.move.images[0].getAttribute("transform"), "translate(8 9)");
    assert.equal(nodes[0].getAttribute("transform"), "translate(2 3) rotate(10)");
    assert.equal(preview.finish(), true);
    assert.equal(nodes[0].style.visibility, "");
    assert.equal(nodes[0].getAttribute("transform"), "translate(8 9) rotate(10)");
    assert.equal(nodes[10].getAttribute("transform"), null);
  } finally { restore(); }
});

test("late raster results cannot replace cancelled or completed drags", async () => {
  const nodes = Array.from({ length: 20 }, (_, index) => fakeNode(String(index)));
  let resolveRender;
  const { preview, restore } = setup(nodes, () => new Promise((resolve) => { resolveRender = resolve; }));
  try {
    const ids = nodes.map((node) => node.dataset.id);
    preview.preview(ids, 4, 5);
    assert.equal(preview.finish({ cancelled: true }), false);
    assert.equal(nodes[0].getAttribute("transform"), null);
    resolveRender("data:image/png;base64,abc");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(preview.move, null);
    assert.ok(nodes.every((node) => node.style.visibility === ""));
  } finally { restore(); }
});

test("raster failure and highly interleaved selections retain vector movement", async () => {
  const nodes = Array.from({ length: 42 }, (_, index) => fakeNode(String(index)));
  let renders = 0;
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  const { preview, restore } = setup(nodes, async () => { renders++; throw new Error("unavailable"); });
  try {
    const contiguous = nodes.slice(0, 20).map((node) => node.dataset.id);
    preview.preview(contiguous, 1, 2);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(renders, 1);
    assert.equal(errors.length, 1);
    assert.equal(preview.move.images, null);
    preview.preview(contiguous, 3, 4);
    assert.equal(nodes[0].getAttribute("transform"), "translate(3 4)");
    preview.finish({ cancelled: true });
    const interleaved = nodes.filter((_, index) => index % 2 === 0).map((node) => node.dataset.id);
    preview.preview(interleaved, 5, 6);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(renders, 1);
    assert.equal(nodes[0].getAttribute("transform"), "translate(5 6)");
    assert.equal(nodes[1].getAttribute("transform"), null);
    preview.finish();
  } finally {
    console.error = originalError;
    restore();
  }
});

test("page-only web fonts retain vector previews instead of changing text appearance", async () => {
  const nodes = Array.from({ length: 20 }, (_, index) => fakeNode(String(index)));
  nodes[0].localName = "text";
  nodes[0].setAttribute("font-family", "CommBurn Mono");
  let renders = 0;
  const { preview, restore } = setup(nodes, async () => { renders++; return "data:image/png;base64,abc"; });
  try {
    preview.preview(nodes.map((node) => node.dataset.id), 1, 2);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(renders, 0);
    assert.equal(nodes[0].style.visibility, "");
    preview.finish({ cancelled: true });
    await preview.flash("a");
    assert.equal(renders, 0);
  } finally { restore(); }
});

test("layer raster cache is reused and stale glow results are discarded", async () => {
  const nodes = [fakeNode("a", "a"), fakeNode("b", "b")];
  const pending = new Map();
  let renders = 0;
  const { preview, restore } = setup(nodes, (source) => {
    renders += 1;
    return new Promise((resolve) => pending.set(source, resolve));
  });
  try {
    const first = preview.flash("a");
    const second = preview.flash("b");
    pending.get("b:")("data:image/png;base64,b");
    await second;
    pending.get("a:")("data:image/png;base64,a");
    await first;
    assert.equal(preview.flashNode.getAttribute("href"), "data:image/png;base64,b");
    await preview.flash("a");
    assert.equal(renders, 2);
    nodes[0].setAttribute("transform", "translate(1 0)");
    const changed = preview.flash("a");
    assert.equal(renders, 3);
    pending.get("a:translate(1 0)")("data:image/png;base64,c");
    await changed;
    assert.equal(preview.flashNode.getAttribute("href"), "data:image/png;base64,c");
  } finally { restore(); }
});
