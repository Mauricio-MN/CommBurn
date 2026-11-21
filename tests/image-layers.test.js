import test from "node:test";
import assert from "node:assert/strict";
import { canMoveElementsToLayer, layerAcceptsKind, moveImagesToLayer, vectorTargetLayers } from "../src/core/image-layers.js";

const layers = [
  { id: "cut", name: "Corte 1", locked: false },
  { id: "photo", name: "Foto", locked: false },
  { id: "locked", name: "Travada", locked: true },
  { id: "vector", name: "Vetor", locked: false }
];

test("vectorization targets exclude locked layers and layers holding other raster images", () => {
  const elements = [
    { id: "source", type: "image", layerId: "photo" },
    { id: "other", type: "image", layerId: "vector" },
    { id: "shape", type: "rect", layerId: "cut" }
  ];
  const targets = vectorTargetLayers(layers, elements, "source").map((layer) => layer.id);
  assert.deepEqual(targets, ["cut", "photo"]);
});

test("the source image's own layer stays a valid vectorization target", () => {
  const elements = [{ id: "source", type: "image", layerId: "photo" }];
  assert.ok(vectorTargetLayers(layers, elements, "source").some((layer) => layer.id === "photo"));
});

test("imported images move to the given layer while vectors keep their layers", () => {
  const elements = [
    { id: "image", type: "image", layerId: "cut" },
    { id: "shape", type: "rect", layerId: "cut" }
  ];
  const moved = moveImagesToLayer(elements, "new-image-layer");
  assert.equal(moved[0].layerId, "new-image-layer");
  assert.equal(moved[1].layerId, "cut");
  assert.equal(elements[0].layerId, "cut", "input must not be mutated");
});

test("a layer keeps one kind: vectors and raster images cannot be mixed by any move", () => {
  const elements = [
    { id: "image", type: "image", layerId: "photo" },
    { id: "shape", type: "rect", layerId: "cut" },
    { id: "other-shape", type: "rect", layerId: "cut" }
  ];
  assert.equal(canMoveElementsToLayer(elements, new Set(["shape"]), "photo"), false);
  assert.equal(canMoveElementsToLayer(elements, new Set(["image"]), "cut"), false);
  assert.equal(canMoveElementsToLayer(elements, new Set(["other-shape"]), "cut"), true);
  assert.equal(canMoveElementsToLayer(elements, new Set(["shape", "other-shape"]), "photo"), false);
  assert.equal(canMoveElementsToLayer(elements, new Set(["image"]), "empty"), true);
  assert.equal(layerAcceptsKind(elements, "photo", "raster"), true);
  assert.equal(layerAcceptsKind(elements, "cut", "raster"), false);
});
