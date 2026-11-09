import { createDocument } from "../core/document.js";
import { DEFAULT_LAYER } from "../core/layers.js";

export function createPresentationDocument() {
  const layer = {
    ...DEFAULT_LAYER,
    id: "presentation-engrave",
    name: "Gravação de demonstração"
  };
  return createDocument({
    widthMm: 180,
    heightMm: 120,
    layers: [layer],
    elements: []
  });
}

export function createPresentationSimulationDocument(documentModel) {
  const elements = documentModel.elements.filter((element) =>
    element.type === "rect"
    && (element.rotationDeg ?? 0) === 0
    && (element.skewXDeg ?? 0) === 0
    && (element.skewYDeg ?? 0) === 0
  );
  if (elements.length === 0) {
    throw new RangeError("A apresentação precisa de pelo menos um retângulo para simular.");
  }
  return createDocument({ ...documentModel, elements });
}
