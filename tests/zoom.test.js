import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clampZoom,
  scrollDeltaToKeepAnchor,
  zoomByFactor,
  zoomPercent
} from "../src/ui/zoom.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("default zoom is 100 percent", () => {
  assert.equal(ZOOM_DEFAULT, 1);
  assert.equal(zoomPercent(ZOOM_DEFAULT), "100%");
});

test("clampZoom keeps the level inside the supported range", () => {
  assert.equal(clampZoom(ZOOM_MIN / 10), ZOOM_MIN);
  assert.equal(clampZoom(ZOOM_MAX * 10), ZOOM_MAX);
  assert.equal(clampZoom(2.5), 2.5);
});

test("clampZoom falls back to the default for non-finite input", () => {
  assert.equal(clampZoom(Number.NaN), ZOOM_DEFAULT);
  assert.equal(clampZoom(Number.POSITIVE_INFINITY), ZOOM_DEFAULT);
  assert.equal(clampZoom(undefined), ZOOM_DEFAULT);
});

test("zoomByFactor applies the factor and clamps the result", () => {
  assert.equal(zoomByFactor(1, ZOOM_STEP), ZOOM_STEP);
  assert.equal(zoomByFactor(ZOOM_MAX, ZOOM_STEP), ZOOM_MAX);
  assert.equal(zoomByFactor(ZOOM_MIN, 1 / ZOOM_STEP), ZOOM_MIN);
});

test("repeated zoom in and out returns to the default within rounding", () => {
  let level = ZOOM_DEFAULT;
  for (let step = 0; step < 3; step += 1) level = zoomByFactor(level, ZOOM_STEP);
  for (let step = 0; step < 3; step += 1) level = zoomByFactor(level, 1 / ZOOM_STEP);
  assert.ok(Math.abs(level - ZOOM_DEFAULT) < 1e-9);
});

test("zoomPercent rounds to whole percent", () => {
  assert.equal(zoomPercent(0.1), "10%");
  assert.equal(zoomPercent(1.256), "126%");
  assert.equal(zoomPercent(ZOOM_MAX), "1600%");
});

test("scrollDeltaToKeepAnchor keeps the anchored point under the pointer", () => {
  // Content was 200 px starting at 100; the pointer sits at 25% of it (x = 150).
  // After zoom the content is 800 px and starts at 50 (centred); the same point is at 250.
  const delta = scrollDeltaToKeepAnchor(150, { start: 100, size: 200 }, { start: 50, size: 800 });
  assert.equal(delta, 100);
  const pointAfter = 50 + 0.25 * 800;
  assert.equal(pointAfter - delta, 150);
});

test("scrollDeltaToKeepAnchor returns zero when nothing was laid out before", () => {
  assert.equal(scrollDeltaToKeepAnchor(10, { start: 0, size: 0 }, { start: 0, size: 300 }), 0);
  assert.equal(scrollDeltaToKeepAnchor(10, { start: 0, size: Number.NaN }, { start: 0, size: 300 }), 0);
});

test("scrollDeltaToKeepAnchor is zero when the content does not move under the anchor", () => {
  assert.equal(scrollDeltaToKeepAnchor(50, { start: 0, size: 100 }, { start: 0, size: 100 }), 0);
});

test("index.html exposes the zoom controls with localized labels", () => {
  const html = read("index.html");
  for (const id of ["zoom-out", "zoom-reset", "zoom-in"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /data-i18n-aria-label="ui\.canvas\.zoomGroup"/);
  assert.match(html, /data-i18n-title="ui\.canvas\.zoomIn"/);
  assert.match(html, /data-i18n-title="ui\.canvas\.zoomOut"/);
  assert.match(html, /data-i18n-title="ui\.canvas\.zoomReset"/);
});

test("both locale catalogs define the zoom labels", () => {
  for (const file of ["src/locales/en.js", "src/locales/pt-BR.js"]) {
    const source = read(file);
    for (const key of ["zoomGroup", "zoomIn", "zoomOut", "zoomReset"]) {
      assert.match(source, new RegExp(`\\b${key}:`), `${file} is missing ${key}`);
    }
  }
});

test("the drawing frame is not clamped to the stage width", () => {
  // A clamped frame would stop the zoomed drawing from overflowing into the scrollable stage.
  const css = read("src/styles.css");
  const rule = css.match(/\.board-frame \{[^}]*\}/);
  assert.ok(rule, ".board-frame rule must exist");
  assert.doesNotMatch(rule[0], /max-width/);
});
