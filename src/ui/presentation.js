import { createDocument } from "../core/document.js";
import { DEFAULT_LAYER } from "../core/layers.js";

// Each substep moves the pointer to `target` and then performs `kind`:
// "type" types `value` character by character, "choose" selects `value`,
// "click" clicks the control, and "simulate" starts the visual simulation.
const substep = (kind, target, value) => Object.freeze({ kind, target, value });

export const PRESENTATION_STEPS = Object.freeze([
  Object.freeze({
    key: "workspace",
    substeps: Object.freeze([
      substep("type", "#width", "200"),
      substep("type", "#height", "140")
    ])
  }),
  Object.freeze({
    key: "text",
    substeps: Object.freeze([
      substep("type", "#text-content", "COMMBURN"),
      substep("choose", "#font-family", "sans-serif"),
      substep("type", "#font-size", "12"),
      substep("type", "#new-x", "61"),
      substep("type", "#new-y", "72"),
      substep("click", "#add-text")
    ])
  }),
  Object.freeze({
    key: "frame",
    substeps: Object.freeze([
      substep("choose", "#new-shape-type", "rect"),
      substep("type", "#new-shape-width", "130"),
      substep("type", "#new-shape-height", "62"),
      substep("type", "#new-x", "35"),
      substep("type", "#new-y", "38"),
      substep("click", "#add-shape")
    ])
  }),
  Object.freeze({
    key: "detail",
    substeps: Object.freeze([
      substep("type", "#new-shape-width", "104"),
      substep("type", "#new-shape-height", "36"),
      substep("type", "#new-x", "48"),
      substep("type", "#new-y", "51"),
      substep("click", "#add-shape")
    ])
  }),
  Object.freeze({
    key: "inspect",
    substeps: Object.freeze([
      substep("type", "#object-x", "50"),
      substep("type", "#object-width", "100")
    ])
  }),
  Object.freeze({
    key: "preview",
    substeps: Object.freeze([
      substep("click", "#preview-machine-job")
    ])
  }),
  Object.freeze({
    key: "simulate",
    substeps: Object.freeze([
      substep("simulate", "#machine-path-preview")
    ])
  })
]);

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
    ["rect", "path", "text"].includes(element.type)
    && (element.rotationDeg ?? 0) === 0
    && (element.skewXDeg ?? 0) === 0
    && (element.skewYDeg ?? 0) === 0
  );
  if (elements.length === 0) {
    throw new RangeError("A apresentação precisa de pelo menos um retângulo para simular.");
  }
  return createDocument({ ...documentModel, elements });
}
