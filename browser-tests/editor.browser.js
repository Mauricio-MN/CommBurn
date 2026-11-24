import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { startServer } from "../server.mjs";
import { renderGrblJob, renderSvg } from "../src/core/document.js";
import { serializeProject } from "../src/core/project.js";

const DEPTH = 5;
const OBJECT_COUNT = 4 ** DEPTH;
const ACTION_TIMEOUT_MS = 15_000;

function squareTree(depth) {
  if (depth === 0) return '<path d="M0 0 L1 0 L1 1 L0 1 Z"/>';
  const step = 2 ** depth;
  const branch = squareTree(depth - 1);
  return [[0, 0], [step, 0], [0, step], [step, step]]
    .map(([x, y]) => `<g transform="translate(${x} ${y})">${branch}</g>`).join("");
}

function fixtureSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="80mm" viewBox="0 0 80 80"><g fill="none" stroke="#222222">${squareTree(DEPTH)}</g></svg>`;
}

let server;
let browser;
before(async () => {
  server = await startServer({ port: 0 });
  browser = await chromium.launch({
    headless: true,
    timeout: ACTION_TIMEOUT_MS,
    ...(process.env.COMMBURN_BROWSER_PATH ? { executablePath: process.env.COMMBURN_BROWSER_PATH } : {})
  });
}, { timeout: 30_000 });

after(async () => {
  try {
    if (browser) await browser.close();
  } finally {
    if (server) await server.close();
  }
}, { timeout: 15_000 });

async function saveDocument(page) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: ACTION_TIMEOUT_MS }),
    page.locator("#save-project").click()
  ]);
  return JSON.parse(await readFile(await download.path(), "utf8")).document;
}

async function layerGlow(page) {
  await page.locator("[data-layer-select]").first().click();
  const image = page.locator("svg.artboard > image.layer-glow");
  await image.waitFor({ state: "attached", timeout: ACTION_TIMEOUT_MS });
  return image.evaluate(async (node) => {
    const bitmap = new Image();
    bitmap.src = node.getAttribute("href");
    await bitmap.decode();
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let opaque = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) opaque += 1;
    return { x: Number(node.getAttribute("x")), y: Number(node.getAttribute("y")), opaque };
  });
}

test("sidebar navigation and compact layers keep settings accessible across screen sizes", { timeout: 30_000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  await page.goto(server.url, { waitUntil: "load" });
  await page.locator("#svg-file-input").setInputFiles({
    name: "layers.commburn.json", mimeType: "application/json",
    buffer: Buffer.from(serializeProject({
      widthMm: 100, heightMm: 80,
      layers: [{ id: "cut", name: "Cut", operation: "cut", powerPercent: 40 }, { id: "fill", name: "Fill", operation: "fill", powerPercent: 20 }],
      elements: [
        { id: "a", type: "rect", xMm: 5, yMm: 5, widthMm: 10, heightMm: 10, layerId: "cut" },
        { id: "b", type: "rect", xMm: 30, yMm: 10, widthMm: 10, heightMm: 10, layerId: "fill" }
      ]
    }))
  });
  const cut = page.locator('#layers-list [data-layer-id="cut"]');
  const fill = page.locator('#layers-list [data-layer-id="fill"]');
  await cut.waitFor();
  assert.equal(await cut.locator(".layer-settings").isVisible(), true);
  assert.equal(await fill.locator(".layer-settings").isVisible(), false);
  assert.match(await fill.locator(".layer-summary").textContent(), /20%/);
  assert.equal(await fill.locator('[data-layer-property="enabled"]').isVisible(), true);
  await fill.locator("[data-layer-select]").click();
  assert.equal(await cut.locator(".layer-settings").isVisible(), false);
  assert.equal(await fill.locator(".layer-settings").isVisible(), true);
  const algorithm = fill.locator('[data-layer-property="fillAlgorithm"]');
  assert.equal(await algorithm.locator("option").count(), 11);
  await algorithm.selectOption("vertical-unidirectional");
  assert.equal(await fill.locator('[data-layer-property="fillAlgorithm"]').inputValue(), "vertical-unidirectional");
  await page.locator("#language-select").selectOption("en");
  assert.match(await fill.locator(".layer-summary").textContent(), /Fill/);
  assert.match(await page.locator(".sidebar-nav").getAttribute("aria-label"), /section/i);
  await page.locator('.sidebar-nav a[href="#machine-panel"]').click();
  assert.ok(await page.locator(".sidebar").evaluate((sidebar) => sidebar.scrollTop > 0));
  assert.equal(await page.locator("#machine-panel").isVisible(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.sidebar-nav a[href="#sidebar-layers"]').click();
  assert.equal(await fill.locator('[data-layer-property="fillAlgorithm"]').isVisible(), true);
  const overflow = await page.locator(".sidebar").evaluate((sidebar) => sidebar.scrollWidth - sidebar.clientWidth);
  assert.ok(overflow <= 1, `sidebar overflows horizontally by ${overflow}px`);
});

test("decorative fill choices generate the same preview and G-code as the saved project", { timeout: 30_000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  t.after(() => context.close());
  await context.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  await page.goto(server.url, { waitUntil: "load" });
  await page.locator("#svg-file-input").setInputFiles({
    name: "pattern.commburn.json", mimeType: "application/json",
    buffer: Buffer.from(serializeProject({
      widthMm: 50, heightMm: 40,
      layers: [{ id: "fill", operation: "fill", fillSpacingMm: 2 }],
      elements: [{ id: "box", type: "rect", xMm: 5, yMm: 5, widthMm: 20, heightMm: 20, layerId: "fill" }]
    }))
  });
  const selector = page.locator('[data-layer-property="fillAlgorithm"]');
  await selector.waitFor({ state: "visible" });
  for (const algorithm of ["inset", "squares", "zigzag", "hilbert"]) {
    await selector.selectOption(algorithm);
    await page.locator("#preview-machine-job").click();
    await page.locator("#machine-preview-dialog").waitFor({ state: "visible" });
    const gcode = await page.locator("#machine-preview-code").textContent();
    assert.ok(await page.locator("#machine-path-preview path").count() > 0, algorithm);
    await page.locator("#machine-preview-dialog .dialog-close").click();
    const saved = await saveDocument(page);
    assert.equal(saved.layers[0].fillAlgorithm, algorithm);
    assert.equal(gcode, renderGrblJob(saved, {
      maxSpindleSpeed: 1000, laserPowerMode: "M4", startFrom: "absolute", startAnchor: "top-left"
    }));
  }
});

test("changing layer order retains job markers and preview with an unfillable object", { timeout: 30_000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  t.after(() => context.close());
  await context.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(server.url, { waitUntil: "load" });
  const documentModel = {
    widthMm: 100, heightMm: 60,
    layers: [{ id: "fill", operation: "fill", fillSpacingMm: 1 }],
    elements: [
      { id: "far", type: "rect", xMm: 60, yMm: 20, widthMm: 4, heightMm: 4, layerId: "fill" },
      { id: "line", type: "path", xMm: 1, yMm: 1, widthMm: 10, heightMm: 0, pathData: "M0 0 L10 0", layerId: "fill" },
      { id: "near", type: "rect", xMm: 5, yMm: 5, widthMm: 4, heightMm: 4, layerId: "fill" }
    ]
  };
  await page.locator("#svg-file-input").setInputFiles({
    name: "ordering.commburn.json", mimeType: "application/json",
    buffer: Buffer.from(serializeProject(documentModel))
  });
  const marker = page.locator('#job-markers circle[fill="#1f9d55"]');
  await page.waitForFunction(() => Number(document.querySelector('#job-markers circle[fill="#1f9d55"]')?.getAttribute("cx")) === 60);
  await page.locator('[data-layer-property="objectOrder"]').selectOption("nearest");
  await page.waitForFunction(() => Number(document.querySelector('#job-markers circle[fill="#1f9d55"]')?.getAttribute("cx")) === 5);
  assert.equal(await marker.count(), 1);
  await page.locator("#preview-machine-job").click();
  await page.locator("#machine-preview-dialog").waitFor({ state: "visible" });
  assert.match(await page.locator("#machine-preview-code").textContent(), /G1 X/);
  assert.deepEqual(errors, []);
  await page.locator("#machine-preview-dialog .dialog-close").click();
  const saved = await saveDocument(page);
  assert.equal(saved.layers[0].objectOrder, "nearest");
  assert.deepEqual(saved.elements.map(({ id }) => id), ["far", "line", "near"]);
});

async function scrollSidebarWithoutRedraw(page) {
  await page.locator(".stage").evaluate(async (stage) => {
    window.testStageMutations = 0;
    window.testStageResizes = 0;
    window.testStageObserver = new MutationObserver((records) => {
      window.testStageMutations += records.filter((record) => {
        const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
        return !element?.closest("#job-markers");
      }).length;
    });
    window.testStageObserver.observe(stage, { attributes: true, characterData: true, childList: true, subtree: true });
    window.testStageResizeObserver = new ResizeObserver(() => { window.testStageResizes += 1; });
    window.testStageResizeObserver.observe(stage);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.testStageResizes = 0;
    window.testStageMutations = 0;
  });
  const sidebar = page.locator(".sidebar");
  await sidebar.evaluate((element) => { element.scrollTop = 0; });
  const box = await sidebar.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  for (let index = 0; index < 5; index += 1) await page.mouse.wheel(0, 250);
  await page.waitForFunction(() => document.querySelector(".sidebar").scrollTop > 0, null, { timeout: ACTION_TIMEOUT_MS });
  assert.deepEqual(await page.evaluate(() => {
    window.testStageObserver.disconnect();
    window.testStageResizeObserver.disconnect();
    return { mutations: window.testStageMutations, resizes: window.testStageResizes };
  }), { mutations: 0, resizes: 0 }, "scrolling must not modify or resize the stage");
}

async function startDrag(page) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+A");
  await page.locator('button[data-tool="move"]').click();
  const first = page.locator("#objects [data-id]").first();
  await first.scrollIntoViewIfNeeded();
  const box = await first.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.locator("#artboard").evaluate((svg) => {
    svg.addEventListener("pointerdown", (event) => { svg.dataset.testPointerId = String(event.pointerId); }, { once: true });
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 18, start.y + 12);
  await page.waitForFunction((count) => {
    const images = document.querySelectorAll("#objects .raster-selection");
    const hidden = document.querySelectorAll('#objects [data-id][style*="visibility: hidden"]');
    return images.length === 1 && hidden.length === count;
  }, OBJECT_COUNT, { timeout: ACTION_TIMEOUT_MS });
  const transform = await page.locator("#objects .raster-selection").getAttribute("transform");
  const match = /^translate\(([-\d.e]+) ([-\d.e]+)\)$/.exec(transform);
  assert.ok(match, `Unexpected raster transform: ${transform}`);
  const pointerId = Number(await page.locator("#artboard").getAttribute("data-test-pointer-id"));
  assert.ok(Number.isInteger(pointerId) && pointerId > 0);
  return { dx: Number(match[1]), dy: Number(match[2]), pointerId };
}

function assertMoved(beforeDocument, afterDocument, dx, dy) {
  assert.equal(afterDocument.elements.length, OBJECT_COUNT);
  const { elements: beforeElements, ...beforeRest } = beforeDocument;
  const { elements: afterElements, ...afterRest } = afterDocument;
  assert.deepEqual(afterRest, beforeRest);
  for (let index = 0; index < OBJECT_COUNT; index += 1) {
    const before = beforeElements[index];
    const after = afterElements[index];
    assert.ok(Math.abs(after.xMm - before.xMm - dx) < 1e-8, `${before.id} X`);
    assert.ok(Math.abs(after.yMm - before.yMm - dy) < 1e-8, `${before.id} Y`);
    const { xMm: ignoredX1, yMm: ignoredY1, ...beforeRest } = before;
    const { xMm: ignoredX2, yMm: ignoredY2, ...afterRest } = after;
    assert.deepEqual(afterRest, beforeRest, `${before.id} data`);
  }
}

test("recursive SVG stays editable through layer glow, raster drag, undo and cancellation", { timeout: 90_000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  t.after(() => context.close());
  await context.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const url = message.location().url;
    if (message.type() === "error" && url !== `${server.url}/favicon.ico`) errors.push(`${message.text()} (${url})`);
  });
  await page.goto(server.url, { waitUntil: "load", timeout: ACTION_TIMEOUT_MS });
  assert.equal(await page.locator("#objects [data-id]").count(), 0);
  await scrollSidebarWithoutRedraw(page);
  await page.locator("#svg-file-input").setInputFiles({
    name: "recursive-tree.svg", mimeType: "image/svg+xml", buffer: Buffer.from(fixtureSvg())
  });
  await page.locator("#svg-import-dialog").waitFor({ state: "visible" });
  await page.locator("#svg-import-mode").selectOption("editable");
  await page.locator('#svg-import-dialog button[value="import"]').click();
  await page.waitForFunction((count) => document.querySelectorAll("#objects [data-id]").length === count,
    OBJECT_COUNT, { timeout: ACTION_TIMEOUT_MS });
  const original = await saveDocument(page);
  assert.equal(original.elements.length, OBJECT_COUNT);
  assert.ok(original.elements.every((element) => element.type === "path"));

  const firstGlow = await layerGlow(page);
  assert.ok(firstGlow.opaque > 0, "layer raster must contain visible pixels");
  assert.deepEqual(await saveDocument(page), original, "glow must not alter the editable project");

  const beforeSelection = await page.locator("#artboard").screenshot({ animations: "disabled" });
  assert.equal(await page.locator("#objects [data-id].selected").count(), 0);
  await scrollSidebarWithoutRedraw(page);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+A");
  await page.locator("#artboard > .selection-glow").waitFor({ state: "attached" });
  const selectionState = await page.locator("#artboard").evaluate((svg) => ({
    selected: svg.querySelectorAll("#objects [data-id].selected").length,
    filtered: [...svg.querySelectorAll("#objects [data-id].selected")]
      .filter((node) => getComputedStyle(node).filter !== "none").length,
    overlays: svg.querySelectorAll(":scope > .selection-glow").length,
    behind: Boolean(svg.querySelector(".selection-glow + #objects"))
  }));
  assert.deepEqual(selectionState, { selected: OBJECT_COUNT, filtered: 0, overlays: 1, behind: true });
  const afterSelection = await page.locator("#artboard").screenshot({ animations: "disabled" });
  const changedPixels = await page.evaluate(async ([before, after]) => {
    const read = async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const [a, b] = await Promise.all([read(before), read(after)]);
    let bluePixels = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (b[i + 2] > b[i] + 10 && b[i + 2] - b[i] > a[i + 2] - a[i] + 5) bluePixels += 1;
    }
    return bluePixels;
  }, [beforeSelection.toString("base64"), afterSelection.toString("base64")]);
  assert.ok(changedPixels > 50, "selection glow must visibly add blue pixels");
  await scrollSidebarWithoutRedraw(page);
  assert.equal(await page.locator("#artboard > .selection-glow").count(), 1);
  assert.equal(await page.locator("#objects [data-id].selected").count(), OBJECT_COUNT);
  const blurBeforeZoom = Number(await page.locator("#artboard defs filter feGaussianBlur").getAttribute("stdDeviation"));
  await page.locator("#zoom-in").click();
  const blurAfterZoom = Number(await page.locator("#artboard defs filter feGaussianBlur").getAttribute("stdDeviation"));
  assert.ok(blurAfterZoom < blurBeforeZoom, "glow width must adapt to zoom");
  await page.locator("#zoom-reset").click();
  assert.deepEqual(await saveDocument(page), original, "sidebar scrolling must not change the document");

  await page.locator("#add-document-tab").click();
  assert.equal(await page.locator("#objects [data-id]").count(), 0);
  assert.equal(await page.locator("#artboard > .selection-glow").count(), 0);
  await scrollSidebarWithoutRedraw(page);
  await page.locator('[data-tab-id="tab-1"]').click();
  await page.locator("#artboard > .selection-glow").waitFor({ state: "attached" });
  assert.equal(await page.locator("#objects [data-id].selected").count(), OBJECT_COUNT);

  const { dx, dy } = await startDrag(page);
  assert.ok(dx > 0 && dy > 0);
  assert.equal(await page.locator("#objects [data-id]").count(), OBJECT_COUNT);
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector("#objects .raster-selection"), null, { timeout: ACTION_TIMEOUT_MS });
  assert.equal(await page.locator('#objects [data-id][style*="visibility: hidden"]').count(), 0);
  const moved = await saveDocument(page);
  assertMoved(original, moved, dx, dy);
  const movedGlow = await layerGlow(page);
  assert.ok(Math.abs(movedGlow.x - firstGlow.x - dx) < 0.1);
  assert.ok(Math.abs(movedGlow.y - firstGlow.y - dy) < 0.1);

  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+Z");
  const restored = await saveDocument(page);
  assert.deepEqual(restored, original);
  assert.equal(renderSvg(restored), renderSvg(original));

  const { pointerId } = await startDrag(page);
  await page.locator("#artboard").evaluate((svg, id) => {
    svg.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: id }));
  }, pointerId);
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector("#objects .raster-selection"), null, { timeout: ACTION_TIMEOUT_MS });
  assert.deepEqual(await saveDocument(page), original, "cancelled drag must not alter the project");
  assert.deepEqual(errors, [], "browser must not report errors");
});

test("interleaved selection uses separate raster runs without moving other objects", { timeout: 60_000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  t.after(() => context.close());
  await context.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  await page.goto(server.url, { waitUntil: "load", timeout: ACTION_TIMEOUT_MS });
  const elements = Array.from({ length: 40 }, (_, index) => {
    const selected = index < 10 || (index >= 20 && index < 30);
    return {
      id: `rect-${index}`, type: "rect", layerId: "layer",
      xMm: (selected ? 10 : 100) + (index % 10) * 3,
      yMm: 10 + Math.floor(index / 20) * 10, widthMm: 2, heightMm: 2
    };
  });
  await page.locator("#svg-file-input").setInputFiles({
    name: "interleaved.commburn.json", mimeType: "application/json",
    buffer: Buffer.from(serializeProject({ widthMm: 180, heightMm: 120, layers: [{ id: "layer" }], elements }))
  });
  await page.waitForFunction(() => document.querySelectorAll("#objects [data-id]").length === 40, null, { timeout: ACTION_TIMEOUT_MS });
  const original = await saveDocument(page);
  const [start, end] = await page.locator("#artboard").evaluate((svg) => {
    const matrix = svg.getScreenCTM();
    return [[5, 5], [50, 35]].map(([x, y]) => {
      const point = svg.createSVGPoint();
      point.x = x;
      point.y = y;
      const screen = point.matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 3 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll("#objects [data-id].selected").length === 20, null, { timeout: ACTION_TIMEOUT_MS });
  await page.locator('button[data-tool="move"]').click();
  const box = await page.locator('#objects [data-id="rect-0"]').boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 12);
  await page.waitForFunction(() => document.querySelectorAll("#objects .raster-selection").length === 2,
    null, { timeout: ACTION_TIMEOUT_MS });
  const state = await page.locator("#objects").evaluate((objects) => {
    const nodes = [...objects.children];
    return {
      images: nodes.filter((node) => node.classList.contains("raster-selection")).map((image) => {
        const index = nodes.indexOf(image);
        return { next: nodes[index + 1]?.dataset.id, transform: image.getAttribute("transform") };
      }),
      hidden: nodes.filter((node) => node.style.visibility === "hidden").length
    };
  });
  assert.deepEqual(state.images.map(({ next }) => next), ["rect-0", "rect-20"]);
  assert.equal(state.hidden, 20);
  const match = /^translate\(([-\d.e]+) ([-\d.e]+)\)$/.exec(state.images[0].transform);
  assert.ok(match);
  const dx = Number(match[1]), dy = Number(match[2]);
  await page.mouse.up();
  const moved = await saveDocument(page);
  for (let index = 0; index < elements.length; index += 1) {
    const selected = index < 10 || (index >= 20 && index < 30);
    const before = original.elements[index];
    const after = moved.elements[index];
    assert.ok(Math.abs(after.xMm - before.xMm - (selected ? dx : 0)) < 1e-8, `${before.id} X`);
    assert.ok(Math.abs(after.yMm - before.yMm - (selected ? dy : 0)) < 1e-8, `${before.id} Y`);
    const { xMm: ignoredX1, yMm: ignoredY1, ...beforeRest } = before;
    const { xMm: ignoredX2, yMm: ignoredY2, ...afterRest } = after;
    assert.deepEqual(afterRest, beforeRest, `${before.id} data`);
  }
});

test("failed reset permits disconnect and choosing another discovered port", { timeout: 30_000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  let connected = true;
  let failed = true;
  let busy = true;
  let connectedPath = "COM3";
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let response;
    if (path === "/api/connection-status") response = { connected, simulated: false, busy, resetFailed: failed && !busy, settings: null, jobStatus: { state: "running", completed: 1, total: 3 } };
    else if (path === "/api/job-status") {
      busy = false;
      response = { state: "stopped", completed: 1, total: 3, resetFailed: true, error: "Job stopped and the controller reset failed: The controller did not become idle after reset" };
    }
    else if (path === "/api/disconnect") { connected = false; failed = false; response = { connected: false }; }
    else if (path === "/api/ports") response = { ports: [{ path: "COM3" }, { path: "COM4" }], warning: null };
    else if (path === "/api/connect") {
      connectedPath = request.postDataJSON().path;
      connected = true;
      response = { connected: true, path: connectedPath, baudRate: 115200, settings: { $30: 1000, $32: 1 } };
    } else if (path === "/api/plugins") response = { plugins: [] };
    else return route.continue();
    await route.fulfill({ json: response });
  });
  await page.goto(server.url, { waitUntil: "load" });
  await page.locator("#machine-state").getByText(/reset|parada/i).waitFor();
  assert.equal(await page.locator("#disconnect-machine").isEnabled(), true);
  assert.equal(await page.locator("#serial-path").isDisabled(), true);
  assert.equal(await page.locator("#start-machine-job").isDisabled(), true);
  await page.reload({ waitUntil: "load" });
  await page.locator("#machine-state").getByText(/reset|parada/i).waitFor();
  assert.equal(await page.locator("#disconnect-machine").isEnabled(), true);
  assert.equal(await page.locator("#start-machine-job").isDisabled(), true);
  await page.locator("#disconnect-machine").click();
  await page.waitForFunction(() => !document.querySelector("#serial-path").disabled);
  await page.locator("#serial-path").fill("COM3");
  await page.locator("#refresh-ports").click();
  await page.waitForFunction(() => document.querySelectorAll("#discovered-ports option").length === 3);
  assert.deepEqual(await page.locator("#discovered-ports option").evaluateAll((nodes) => nodes.map((node) => node.value)), ["", "COM3", "COM4"]);
  await page.locator("#discovered-ports").selectOption("COM4");
  assert.equal(await page.locator("#serial-path").inputValue(), "COM4");
  await page.locator("#connect-machine").click();
  await page.waitForFunction(() => document.querySelector("#disconnect-machine").disabled === false);
  assert.equal(connectedPath, "COM4");
});

test("a running job view reopens with current progress and preserves timeline review", { timeout: 30_000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  let connected = false;
  let state = "idle";
  let completed = 0;
  const total = 30;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let response;
    if (path === "/api/connection-status") response = { connected, simulated: connected, busy: state === "running" || state === "paused", resetFailed: false, settings: null, jobStatus: { state, completed, total } };
    else if (path === "/api/simulate-connect") { connected = true; response = { connected: true, simulated: true }; }
    else if (path === "/api/job") { state = "running"; response = { accepted: true, lines: total }; }
    else if (path === "/api/job-status") response = { state, completed, total, position: null, report: null };
    else if (path === "/api/job-pause") { state = "paused"; response = { paused: true }; }
    else if (path === "/api/job-resume") { state = "running"; response = { resumed: true }; }
    else if (path === "/api/plugins") response = { plugins: [] };
    else return route.continue();
    await route.fulfill({ json: response });
  });
  await page.goto(server.url, { waitUntil: "load" });
  await page.locator("#svg-file-input").setInputFiles({
    name: "job.commburn.json", mimeType: "application/json",
    buffer: Buffer.from(serializeProject({
      widthMm: 100, heightMm: 80,
      elements: [{ id: "frame", type: "rect", xMm: 10, yMm: 5, widthMm: 20, heightMm: 15 }]
    }))
  });
  await page.waitForFunction(() => document.querySelectorAll("#objects [data-id]").length === 1);
  await page.locator("#simulate-machine").click();
  await page.waitForFunction(() => !document.querySelector("#start-machine-job").disabled);
  await page.locator("#start-mode").selectOption("head");
  await page.locator('[data-anchor-point="center"]').click();
  const jobRequest = page.waitForRequest((request) => request.url().endsWith("/api/job") && request.method() === "POST");
  await page.locator("#start-machine-job").click();
  const sent = (await jobRequest).postDataJSON();
  assert.equal(sent.settings.startFrom, "objects");
  assert.equal(sent.settings.startAnchor, "center");
  assert.match(renderGrblJob(sent.document, sent.settings), /^G21\nG91\nG94\nM5\n/);
  await page.locator("#machine-preview-dialog").waitFor({ state: "visible" });
  const code = await page.locator("#machine-preview-code").textContent();
  await page.locator("#machine-preview-dialog .dialog-close").click();
  assert.match(await page.locator("#preview-machine-job").textContent(), /trabalho em andamento|running job/i);
  completed = 8;
  await page.waitForFunction(() => document.querySelector("#machine-state").textContent.includes("8/30"));
  await page.locator("#preview-machine-job").click();
  await page.locator("#machine-preview-dialog").waitFor({ state: "visible" });
  assert.equal(await page.locator("#machine-timeline-scrub").inputValue(), "8");
  assert.equal(await page.locator("#machine-preview-code").textContent(), code);
  await page.locator('#machine-simulation-job-controls [data-machine-job-control="pause"]').click();
  await page.waitForFunction(() => !document.querySelector('#machine-simulation-job-controls [data-machine-job-control="resume"]').disabled);
  await page.locator("#machine-timeline-scrub").fill("2");
  await page.locator("#machine-preview-dialog .dialog-close").click();
  await page.setViewportSize({ width: 1200, height: 800 });
  completed = 15;
  await page.waitForFunction(() => document.querySelector("#machine-state").textContent.includes("15/30"));
  await page.locator("#preview-machine-job").click();
  await page.locator("#machine-preview-dialog").waitFor({ state: "visible" });
  assert.equal(await page.locator("#machine-timeline-scrub").inputValue(), "2");
  assert.equal(await page.locator("#machine-timeline-live").isVisible(), true);
  assert.equal(await page.locator('#machine-simulation-job-controls [data-machine-job-control="resume"]').isEnabled(), true);
  await page.locator("#machine-timeline-live").click();
  assert.equal(await page.locator("#machine-timeline-scrub").inputValue(), "15");
});

test("the simulated controller keeps a paused job available after closing its view", { timeout: 30_000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  await page.goto(server.url, { waitUntil: "load" });
  await page.locator("#svg-file-input").setInputFiles({
    name: "simulated.commburn.json", mimeType: "application/json",
    buffer: Buffer.from(serializeProject({
      widthMm: 100, heightMm: 80,
      elements: [{ id: "frame", type: "rect", xMm: 10, yMm: 5, widthMm: 20, heightMm: 15 }]
    }))
  });
  await page.waitForFunction(() => document.querySelectorAll("#objects [data-id]").length === 1);
  await page.locator("#simulate-machine").click();
  await page.waitForFunction(() => !document.querySelector("#start-machine-job").disabled);
  await page.locator("#start-machine-job").click();
  await page.locator("#machine-preview-dialog").waitFor({ state: "visible" });
  await page.locator('#machine-simulation-job-controls [data-machine-job-control="pause"]').click();
  await page.waitForFunction(() => !document.querySelector('#machine-simulation-job-controls [data-machine-job-control="resume"]').disabled);
  await page.locator("#machine-preview-dialog .dialog-close").click();
  await page.locator("#preview-machine-job").click();
  await page.locator("#machine-preview-dialog").waitFor({ state: "visible" });
  assert.equal(await page.locator('#machine-simulation-job-controls [data-machine-job-control="resume"]').isEnabled(), true);
  await page.locator('#machine-simulation-job-controls [data-machine-job-control="stop"]').click();
  await page.waitForFunction(() => !document.querySelector("#disconnect-machine").disabled);
  await page.locator("#machine-preview-dialog .dialog-close").click();
  await page.locator("#disconnect-machine").click();
  await page.waitForFunction(() => !document.querySelector("#simulate-machine").disabled);
});

test("a running job without its original plan is not replaced with the current document preview", { timeout: 30_000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/connection-status") {
      return route.fulfill({ json: { connected: true, simulated: false, busy: true, resetFailed: false, settings: null, jobStatus: { state: "running", completed: 3, total: 30 } } });
    }
    if (path === "/api/job-status") return route.fulfill({ json: { state: "running", completed: 3, total: 30, position: null, report: null } });
    return route.continue();
  });
  await page.goto(server.url, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("#machine-state").textContent.includes("3/30"));
  assert.equal(await page.locator("#preview-machine-job").isDisabled(), true);
  await page.locator('[data-action="preview-machine"]').evaluate((button) => button.click());
  await page.waitForFunction(() => /não está disponível|unavailable/i.test(document.querySelector("#notice-log-text").value));
  assert.equal(await page.locator("#machine-preview-dialog").isVisible(), false);
});
