import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { importTracedImageSvg } from "../src/core/image-trace.js";
import { DEFAULT_LAYER } from "../src/core/layers.js";

const require = createRequire(import.meta.url);
const ImageTracer = require("imagetracerjs");
const svgson = require("svgson");

function traceSample(data = new Uint8ClampedArray([
    0, 0, 0, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 0, 0, 0, 255
  ])) {
  const svg = ImageTracer.imagedataToSVG({ data, width: 2, height: 2 }, {
    numberofcolors: 2,
    viewbox: true
  });
  return svgson.parseSync(svg);
}

test("ImageTracer paths import as metric engraving vectors with tonal power", () => {
  const result = importTracedImageSvg(traceSample(), {
    widthMm: 20,
    heightMm: 10,
    minimumPowerPercent: 8,
    maximumPowerPercent: 35,
    sourceLayer: DEFAULT_LAYER,
    idPrefix: "image-trace-test"
  });

  assert.equal(result.elements.length, 1);
  assert.equal(result.layers.length, 1);
  assert.equal(result.layers[0].color, "#000000");
  assert.equal(result.elements[0].layerId, result.layers[0].id);
  assert.ok(result.elements[0].widthMm > 0);
  assert.ok(result.elements[0].xMm + result.elements[0].widthMm <= 20);
  assert.equal(result.elements[0].heightMm, 10);
  assert.equal(result.elements[0].powerPercent, 35);
});

test("ImageTracer removes near-white paths below the minimum engraving power", () => {
  const whiteImage = new Uint8ClampedArray(16).fill(255);
  assert.throws(() => importTracedImageSvg(traceSample(whiteImage), {
    widthMm: 20,
    heightMm: 10,
    minimumPowerPercent: 8,
    maximumPowerPercent: 35,
    sourceLayer: DEFAULT_LAYER,
    idPrefix: "image-trace-empty"
  }), /produced no engraving paths/);
});
