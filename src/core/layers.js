const LAYER_OPERATIONS = new Set(["engrave", "cut", "fill"]);
const LAYER_COLORS = new Set(["#3978eb", "#e58a2d", "#32a77f", "#9665d8", "#d65d8c", "#5a718f"]);

function finitePositive(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite number greater than zero`);
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
  enabled: true,
  visible: true,
  locked: false,
  color: "#3978eb"
});

export function normalizeLayers(inputLayers = [DEFAULT_LAYER]) {
  if (!Array.isArray(inputLayers) || inputLayers.length === 0) {
    throw new RangeError("A document must contain at least one layer");
  }
  const ids = new Set();
  return inputLayers.map((layer, index) => {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) {
      throw new TypeError(`Layer ${index + 1} must be an object`);
    }
    const id = String(layer.id ?? `layer-${index + 1}`);
    const name = String(layer.name ?? `Camada ${index + 1}`).trim();
    const operation = layer.operation ?? "engrave";
    if (!id.trim() || ids.has(id)) throw new RangeError(`Layer id must be unique and non-empty: ${id}`);
    if (!name) throw new RangeError(`Layer ${id} name must not be empty`);
    if (!LAYER_OPERATIONS.has(operation)) throw new RangeError(`Layer ${id} has unsupported operation: ${operation}`);
    const powerPercent = layer.powerPercent ?? 10;
    if (typeof powerPercent !== "number" || !Number.isFinite(powerPercent) || powerPercent <= 0 || powerPercent > 100) {
      throw new RangeError(`Layer ${id} powerPercent must be greater than zero and at most 100`);
    }
    const passes = layer.passes ?? 1;
    if (!Number.isSafeInteger(passes) || passes < 1 || passes > 100) {
      throw new RangeError(`Layer ${id} passes must be an integer between 1 and 100`);
    }
    const enabled = layer.enabled ?? true;
    const visible = layer.visible ?? true;
    const locked = layer.locked ?? false;
    if ([enabled, visible, locked].some((value) => typeof value !== "boolean")) {
      throw new TypeError(`Layer ${id} enabled, visible, and locked settings must be boolean`);
    }
    const color = layer.color ?? DEFAULT_LAYER.color;
    if (!LAYER_COLORS.has(color)) throw new RangeError(`Layer ${id} has an unsupported display color`);
    ids.add(id);
    return {
      id,
      name,
      operation,
      feedMmPerMinute: finitePositive(layer.feedMmPerMinute ?? 300, `Layer ${id} feedMmPerMinute`),
      powerPercent,
      passes,
      fillSpacingMm: finitePositive(layer.fillSpacingMm ?? 1, `Layer ${id} fillSpacingMm`),
      enabled,
      visible,
      locked,
      color
    };
  });
}
