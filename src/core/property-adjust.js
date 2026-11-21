export const ADJUSTABLE_PROPERTIES = Object.freeze({
  xMm: { minimum: -Infinity },
  yMm: { minimum: -Infinity },
  widthMm: { minimum: 0, positiveTypes: ["rect", "ellipse"] },
  heightMm: { minimum: 0, positiveTypes: ["rect", "ellipse"] },
  rotationDeg: { minimum: -Infinity }
});

function minimumFor(element, property) {
  const { minimum, positiveTypes = [] } = ADJUSTABLE_PROPERTIES[property];
  return positiveTypes.includes(element.type) ? 0.1 : minimum;
}

// mode "set" links every selected element to the same value;
// mode "relative" adds the delta to each element's own value.
export function computeAdjustedUpdates(elements, selectedIds, { property, mode, value }) {
  if (!ADJUSTABLE_PROPERTIES[property]) throw new RangeError(`Propriedade não ajustável: ${property}`);
  if (!Number.isFinite(value)) throw new RangeError("Valor inválido para ajuste de propriedade.");
  if (mode !== "set" && mode !== "relative") throw new RangeError(`Modo de ajuste desconhecido: ${mode}`);

  const updates = [];
  for (const id of selectedIds) {
    const element = elements.find((candidate) => candidate.id === id);
    if (!element) continue;
    const current = element[property];
    if (mode === "relative" && !Number.isFinite(current)) continue;
    const next = mode === "set" ? value : current + value;
    const bounded = Math.max(minimumFor(element, property), next);
    updates.push({ id, patch: { [property]: bounded } });
  }
  return updates;
}
