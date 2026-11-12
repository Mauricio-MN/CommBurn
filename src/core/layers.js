import { CommBurnRangeError, CommBurnTypeError } from "./i18n.js";

const LAYER_OPERATIONS = new Set(["engrave", "cut", "fill"]);
export const FILL_ALGORITHMS = Object.freeze([
  "horizontal-serpentine",
  "vertical-serpentine",
  "crosshatch",
  "horizontal-unidirectional",
  "vertical-unidirectional",
  "diagonal-serpentine",
  "diagonal-crosshatch"
]);
export const OBJECT_ORDERS = Object.freeze(["document", "nearest", "center-out"]);
function finitePositive(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new CommBurnRangeError("layers.positiveNumber", { label }, { message: `${label} must be a finite number greater than zero` });
  }
  return value;
}

export const DEFAULT_LAYER = Object.freeze({
  id: "layer-engrave",
  name: "Gravação 1",
  operation: "engrave",
  feedMmPerMinute: 300,
  powerPercent: 10,
  passes: 1,
  fillSpacingMm: 1,
  fillAlgorithm: "horizontal-serpentine",
  objectOrder: "document",
  enabled: true,
  visible: true,
  locked: false,
  color: "#3978eb"
});

export function normalizeLayers(inputLayers = [DEFAULT_LAYER]) {
  if (!Array.isArray(inputLayers) || inputLayers.length === 0) {
    throw new CommBurnRangeError("layers.invalidCount", {}, { message: "A document must contain at least one layer" });
  }
  const ids = new Set();
  return inputLayers.map((layer, index) => {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
      throw new CommBurnTypeError("layers.invalidObject", { index: index + 1 }, { message: `Layer ${index + 1} must be an object` });
    }
    const id = String(layer.id ?? `layer-${index + 1}`);
    const name = String(layer.name ?? `Camada ${index + 1}`).trim();
    const operation = layer.operation ?? "engrave";
    if (!id.trim() || ids.has(id)) throw new CommBurnRangeError("layers.invalidId", { id }, { message: `Layer id must be unique and non-empty: ${id}` });
    if (!name) throw new CommBurnRangeError("layers.emptyName", { id }, { message: `Layer ${id} name must not be empty` });
    if (!LAYER_OPERATIONS.has(operation)) throw new CommBurnRangeError("layers.invalidOperation", { id, operation }, { message: `Layer ${id} has unsupported operation: ${operation}` });
    const powerPercent = layer.powerPercent ?? 10;
    if (typeof powerPercent !== "number" || !Number.isFinite(powerPercent) || powerPercent <= 0 || powerPercent > 100) {
      throw new CommBurnRangeError("layers.invalidPower", { id }, { message: `Layer ${id} powerPercent must be greater than zero and at most 100` });
    }
    const passes = layer.passes ?? 1;
    if (!Number.isSafeInteger(passes) || passes < 1 || passes > 100) {
      throw new CommBurnRangeError("layers.invalidPasses", { id }, { message: `Layer ${id} passes must be an integer between 1 and 100` });
    }
    const fillAlgorithm = layer.fillAlgorithm ?? "horizontal-serpentine";
    if (!FILL_ALGORITHMS.includes(fillAlgorithm)) {
      throw new CommBurnRangeError("layers.invalidFillAlgorithm", { id, algorithm: fillAlgorithm }, { message: `Layer ${id} has unsupported fill algorithm: ${fillAlgorithm}` });
    }
    const objectOrder = layer.objectOrder ?? "document";
    if (!OBJECT_ORDERS.includes(objectOrder)) {
      throw new CommBurnRangeError("layers.invalidObjectOrder", { id, order: objectOrder }, { message: `Layer ${id} has unsupported object order: ${objectOrder}` });
    }
    const enabled = layer.enabled ?? true;
    const visible = layer.visible ?? true;
    const locked = layer.locked ?? false;
    if ([enabled, visible, locked].some((value) => typeof value !== "boolean")) {
      throw new CommBurnTypeError("layers.invalidFlags", { id }, { message: `Layer ${id} enabled, visible, and locked settings must be boolean` });
    }
    const color = String(layer.color ?? DEFAULT_LAYER.color).toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) throw new CommBurnRangeError("layers.invalidColor", { id }, { message: `Layer ${id} color must be a six-digit hexadecimal value` });
    ids.add(id);
    return {
      id,
      name,
      operation,
      feedMmPerMinute: finitePositive(layer.feedMmPerMinute ?? 300, `Layer ${id} feedMmPerMinute`),
      powerPercent,
      passes,
      fillSpacingMm: finitePositive(layer.fillSpacingMm ?? 1, `Layer ${id} fillSpacingMm`),
      fillAlgorithm,
      objectOrder,
      enabled,
      visible,
      locked,
      color
    };
  });
}
