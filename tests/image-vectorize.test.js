import test from "node:test";
import assert from "node:assert/strict";
import { renderGrblJob } from "../src/core/document.js";
import { vectorizePixels } from "../src/core/image-vectorize.js";

function raster(rows) {
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * rows.length * 4);
  rows.forEach((row, y) => row.forEach((color, x) => {
    const offset = (y * width + x) * 4;
    data.set([...color, 255], offset);
  }));
  return { data, width, height: rows.length };
}

const baseOptions = {
  xMm: 10,
  yMm: 20,
  widthMm: 4,
  heightMm: 2,
  pitchMm: 1,
  mode: "lines",
  layerId: "engrave",
  targetColor: "#000000",
  colorTolerance: 0,
  minimumPowerPercent: 1,
  maximumPowerPercent: 80
};

test("raster line conversion creates metric paths with quantized variable power", () => {
  const image = raster([
    [[0, 0, 0], [0, 0, 0], [255, 255, 255], [0, 0, 0]],
    [[0, 0, 0], [0, 0, 0], [255, 255, 255], [0, 0, 0]]
  ]);
  const result = vectorizePixels(image.data, image.width, image.height, baseOptions);

  assert.equal(result.elements.length, 4);
  assert.deepEqual(result.elements.map(({ xMm, yMm, widthMm, heightMm, powerPercent }) =>
    [xMm, yMm, widthMm, heightMm, powerPercent]
  ), [
    [10, 20, 2, 0, 80],
    [13, 20, 1, 0, 80],
    [13, 21, 1, 0, 80],
    [10, 21, 2, 0, 80]
  ]);
  assert.match(result.elements[2].pathData, /^M 1 0 L 0 0$/);
  assert.equal(result.preview.width, 4);
});

test("color proximity filters engraving paths and stippling creates closed dots", () => {
  const image = raster([[[0, 0, 0], [0, 0, 255], [255, 255, 255]]]);
  const result = vectorizePixels(image.data, image.width, image.height, {
    ...baseOptions,
    widthMm: 3,
    heightMm: 1,
    mode: "dots",
    colorTolerance: 80
  });

  assert.equal(result.elements.length, 1);
  assert.match(result.elements[0].pathData, /Z$/);
  assert.ok(result.elements[0].powerPercent > 0);
});

test("vectorized image paths feed GRBL with changing S power values", () => {
  const image = raster([[[0, 0, 0], [128, 128, 128]]]);
  const result = vectorizePixels(image.data, image.width, image.height, {
    ...baseOptions,
    widthMm: 2,
    heightMm: 1
  });
  const gcode = renderGrblJob({
    widthMm: 20,
    heightMm: 20,
    layers: [{ id: "engrave", operation: "engrave", powerPercent: 10 }],
    elements: result.elements.map((element) => ({ ...element, layerId: "engrave" }))
  }, { maxSpindleSpeed: 1000 });

  assert.match(gcode, /M4 S800/);
  assert.match(gcode, /M4 S400/);
});

test("raster vector conversion rejects invalid dimensions, power, and oversized output", () => {
  const image = raster([[[0, 0, 0]]]);
  assert.throws(() => vectorizePixels(image.data, 1, 1, { ...baseOptions, widthMm: 0 }), /widthMm/);
  assert.throws(() => vectorizePixels(image.data, 1, 1, { ...baseOptions, minimumPowerPercent: 90 }), /power range/);
  assert.throws(() => vectorizePixels(image.data, 1, 1, { ...baseOptions, mode: "raster" }), /mode/);
});
