import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { importTracedImageSvg } from "../src/core/image-trace.js";
import { planGrblJob, renderSvg } from "../src/core/document.js";
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

test("ImageTracer validation errors expose stable codes and preserve RangeError", () => {
  assert.throws(() => importTracedImageSvg(null, {
    widthMm: 0,
    heightMm: 10,
    sourceLayer: DEFAULT_LAYER
  }), (error) => {
    assert.ok(error instanceof RangeError);
    assert.equal(error.code, "imageTrace.invalidDimension");
    return true;
  });
  assert.throws(() => importTracedImageSvg(traceSample(), {
    xMm: Number.NaN,
    widthMm: 10,
    heightMm: 10,
    sourceLayer: DEFAULT_LAYER
  }), (error) => {
    assert.ok(error instanceof RangeError);
    assert.equal(error.code, "imageTrace.invalidPosition");
    return true;
  });
});

test("ImageTracer regions stay as solid, individually colored metric paths without new layers", () => {
  const result = importTracedImageSvg(traceSample(), {
    widthMm: 20,
    heightMm: 10,
    sourceLayer: DEFAULT_LAYER,
    idPrefix: "image-trace-test"
  });

  assert.equal(result.elements.length, 2);
  assert.equal("layers" in result, false);
  assert.deepEqual(new Set(result.elements.map((element) => element.color)), new Set(["#000000", "#ffffff"]));
  assert.ok(result.elements.every((element) => element.strokeWidthMm === undefined));
  assert.ok(result.elements.every((element) => element.layerId === DEFAULT_LAYER.id));
  assert.ok(result.elements.every((element) => /z$/i.test(element.pathData.trim())));
  assert.ok(result.elements.every((element) => element.widthMm > 0 && element.heightMm > 0));
  assert.ok(result.elements.every((element) => element.xMm + element.widthMm <= 20));
  assert.ok(result.elements.every((element) => element.heightMm === 10));
  assert.equal(result.stats.colorCount, 2);

  const svg = renderSvg({ widthMm: 20, heightMm: 10, layers: [DEFAULT_LAYER], elements: result.elements });
  assert.match(svg, /fill="#000000" stroke="none"/);
  assert.match(svg, /fill="#ffffff" stroke="none"/);
});

test("ImageTracer preserves white regions as selectable solid vectors", () => {
  const whiteImage = new Uint8ClampedArray(16).fill(255);
  const result = importTracedImageSvg(traceSample(whiteImage), {
    widthMm: 20,
    heightMm: 10,
    sourceLayer: DEFAULT_LAYER,
    idPrefix: "image-trace-empty"
  });
  assert.equal(result.elements.length, 1);
  assert.equal(result.elements[0].color, "#ffffff");
  assert.equal("layers" in result, false);
});

test("ImageTracer vectors preserve the source object's metric position", () => {
  const result = importTracedImageSvg(traceSample(), {
    xMm: 12,
    yMm: 7,
    widthMm: 20,
    heightMm: 10,
    sourceLayer: DEFAULT_LAYER,
    idPrefix: "image-trace-offset"
  });

  assert.equal(Math.min(...result.elements.map((element) => element.xMm)), 12);
  assert.equal(Math.min(...result.elements.map((element) => element.yMm)), 7);
  assert.ok(result.elements.every((element) => element.xMm + element.widthMm <= 32));
  assert.ok(result.elements.every((element) => element.yMm + element.heightMm <= 17));
});

test("ImageTracer curve smoothing stays inside the source image and GRBL work area", () => {
  const width = 32;
  const height = 24;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isBlack = (x * 7 + y * 13) % 11 < 5;
      data[offset] = isBlack ? 0 : 255;
      data[offset + 1] = isBlack ? 0 : 255;
      data[offset + 2] = isBlack ? 0 : 255;
      data[offset + 3] = 255;
    }
  }
  const tracedSvg = ImageTracer.imagedataToSVG({ data, width, height }, {
    numberofcolors: 8,
    pathomit: 0,
    ltres: 1,
    qtres: 1,
    colorsampling: 2,
    colorquantcycles: 3,
    layering: 0,
    rightangleenhance: true,
    scale: 1,
    roundcoords: 1,
    viewbox: true
  });
  const tracedTree = svgson.parseSync(tracedSvg);
  const imported = importTracedImageSvg(tracedTree, {
    widthMm: 180,
    heightMm: 120,
    sourceLayer: DEFAULT_LAYER,
    idPrefix: "image-trace-bounds"
  });
  const bounds = imported.elements.reduce((result, element) => ({
    minX: Math.min(result.minX, element.xMm),
    minY: Math.min(result.minY, element.yMm),
    maxX: Math.max(result.maxX, element.xMm + element.widthMm),
    maxY: Math.max(result.maxY, element.yMm + element.heightMm)
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

  assert.equal(bounds.minX, 0);
  assert.equal(bounds.minY, 0);
  assert.equal(bounds.maxX, 180);
  assert.equal(bounds.maxY, 120);
  assert.doesNotThrow(() => planGrblJob({
    widthMm: 180,
    heightMm: 120,
    layers: [DEFAULT_LAYER],
    elements: imported.elements
  }, { maxSpindleSpeed: 1000 }));
});

test("ImageTracer paths can generate a GRBL fill on the current fill layer", () => {
  const fillLayer = { ...DEFAULT_LAYER, id: "image-fill", operation: "fill", fillSpacingMm: 1 };
  const tree = svgson.parseSync('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="#ff0000" d="M 0 0 L 10 0 L 10 10 L 0 10 Z"/></svg>');
  const vectors = importTracedImageSvg(tree, {
    widthMm: 20,
    heightMm: 10,
    sourceLayer: fillLayer,
    idPrefix: "image-fill-test"
  });
  const plan = planGrblJob({
    widthMm: 20,
    heightMm: 10,
    layers: [fillLayer],
    elements: vectors.elements
  }, { maxSpindleSpeed: 1000 });

  assert.ok(plan.paths.some((path) => path.kind === "work" && path.algorithm === "horizontal-serpentine"));
  assert.match(plan.gcode, /M4 S100/);
});

test("image preview keeps source colors and editor vectors follow the layer color and operation", () => {
  const vector = {
    id: "region-red",
    type: "path",
    xMm: 0,
    yMm: 0,
    widthMm: 10,
    heightMm: 10,
    pathData: "M 0 0 L 10 0 L 10 10 Z",
    layerId: DEFAULT_LAYER.id,
    color: "#ff0000",
    fillColorMode: "image",
    strokeColorMode: "layer",
    strokeWidthMm: 0.2
  };
  const renderWithLayerColor = (color, element = vector) => renderSvg({
    widthMm: 20,
    heightMm: 20,
    layers: [{ ...DEFAULT_LAYER, color, operation: "fill" }],
    elements: [element]
  });

  const previewSvg = renderSvg({
    widthMm: 20,
    heightMm: 20,
    layers: [{ ...DEFAULT_LAYER, color: "#123456", operation: "fill" }],
    elements: [{ ...vector, fillColorMode: "image", strokeColorMode: "none", strokeWidthMm: 0 }]
  });
  assert.match(previewSvg, /fill="#ff0000" stroke="none"/);

  const editorVector = { ...vector, fillColorMode: "layer", strokeColorMode: "layer" };
  assert.match(renderWithLayerColor("#123456", editorVector), /fill="#123456" stroke="none"/);
  assert.match(renderSvg({
    widthMm: 20,
    heightMm: 20,
    layers: [{ ...DEFAULT_LAYER, color: "#654321", operation: "fill" }],
    elements: [editorVector]
  }), /fill="#654321" stroke="none"/);

  const layerFill = renderSvg({
    widthMm: 20,
    heightMm: 20,
    layers: [{ ...DEFAULT_LAYER, color: "#123456", operation: "fill" }],
    elements: [{ ...vector, fillColorMode: "layer", strokeColorMode: "none" }]
  });
  assert.match(layerFill, /fill="#123456" stroke="none"/);

  const engraveOutline = renderSvg({
    widthMm: 20,
    heightMm: 20,
    layers: [{ ...DEFAULT_LAYER, color: "#123456", operation: "engrave" }],
    elements: [{ ...vector, fillColorMode: "layer", strokeColorMode: "none" }]
  });
  assert.match(engraveOutline, /fill="none" stroke="#123456" stroke-width="0\.2"/);
});
