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

test("image preview keeps source colors and editor vectors always follow the layer color", () => {
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
    layers: [{ ...DEFAULT_LAYER, color }],
    elements: [element]
  });

  const previewSvg = renderSvg({
    widthMm: 20,
    heightMm: 20,
    layers: [{ ...DEFAULT_LAYER, color: "#123456" }],
    elements: [{ ...vector, fillColorMode: "image", strokeColorMode: "none", strokeWidthMm: 0 }]
  });
  assert.match(previewSvg, /fill="#ff0000" stroke="none"/);

  const editorVector = { ...vector, fillColorMode: "layer", strokeColorMode: "layer" };
  assert.match(renderWithLayerColor("#123456", editorVector), /fill="#123456" stroke="#123456" stroke-width="0\.2"/);
  assert.match(renderSvg({
    widthMm: 20,
    heightMm: 20,
    layers: [{ ...DEFAULT_LAYER, color: "#654321" }],
    elements: [editorVector]
  }), /fill="#654321" stroke="#654321" stroke-width="0\.2"/);

  const layerFill = renderSvg({
    widthMm: 20,
    heightMm: 20,
    layers: [{ ...DEFAULT_LAYER, color: "#123456" }],
    elements: [{ ...vector, fillColorMode: "layer", strokeColorMode: "none" }]
  });
  assert.match(layerFill, /fill="#123456" stroke="none"/);
});
