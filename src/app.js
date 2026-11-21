import { createDocument, jobReferencePoints, jobStartSettings, machineFrame, planGrblJob, planToDocumentSpace, renderSvg } from "./core/document.js";
import { createI18n } from "./core/i18n.js";
import { importTracedImageSvg } from "./core/image-trace.js";
import { isFontInstalled } from "./font-availability.js";
import { listSystemFontFamilies } from "./ui/font-options.js";
import { parseProject, serializeProject } from "./core/project.js";
import { ImageEditor as RasterImageEditor } from "../node_modules/@jodit/image-editor/dist/jodit-image-editor.js";
import { CanvasController } from "./ui/canvas-controller.js";
import { DocumentHistory } from "./ui/history.js";
import { installShortcuts, SHORTCUTS } from "./ui/shortcuts.js";
import { connectToolbar, TOOLS } from "./ui/toolbar.js";
import { installTooltips } from "./ui/tooltips.js";
import { LayersPanel } from "./ui/layers-panel.js";
import { PathEditor } from "./ui/path-editor.js";
import { getInspectorSections } from "./ui/inspector-state.js";
import { ADJUSTABLE_PROPERTIES, computeAdjustedUpdates } from "./core/property-adjust.js";
import { loadDesktopPlugins } from "./ui/plugins.js";
import { createNativeMachineApi, isNativeApp } from "./machine/native-machine.js";
import { machineAreaFromSettings } from "./machine/grbl.js";
import { translateDom } from "./ui/dom-i18n.js";
import { clampZoom, scrollDeltaToKeepAnchor, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, zoomByFactor, zoomPercent } from "./ui/zoom.js";
import {
  clearNumberFieldError,
  showNumberFieldError,
  validateNumberField
} from "./ui/field-validation.js";
import enCatalog from "./locales/en.js";
import ptBrCatalog from "./locales/pt-BR.js";
import { moveImagesToLayer, vectorTargetLayers } from "./core/image-layers.js";
import { fitImportedToTable, importSvgTree, nextImportIdPrefix, validateSvgSource } from "./core/svg-import.js";
import { selectMany as mergeSelection, selectOne } from "./ui/selection.js";
import { applyStageBackground, normalizeStageBackground, STAGE_BACKGROUND_DEFAULT, STAGE_BACKGROUND_STORAGE_KEY } from "./ui/stage-background.js";
import {
  createMachinePlayback,
  createMachineTrack,
  formatOperationTimeEstimates,
  getMachinePlaybackSegments,
  groupMachinePreviewPaths,
  locateMachinePosition
} from "./ui/machine-preview.js";
import {
  createPresentationDocument,
  createPresentationSimulationDocument,
  PRESENTATION_STEPS
} from "./ui/presentation.js";

const byId = (id) => document.getElementById(id);
const savedLocale = (() => {
  try { return localStorage.getItem("commburn.locale"); } catch { return null; }
})();
const i18n = createI18n({
  locale: savedLocale || navigator.languages,
  catalogs: { en: enCatalog, "pt-BR": ptBrCatalog },
  fallbackLocale: "en",
  onMissing: ({ key, locale }) => console.debug(`Missing translation: ${locale}:${key}`)
});
window.history.scrollRestoration = "manual";
window.addEventListener("pageshow", () => {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}, { once: true });
const SIMULATOR_MAX_SPINDLE_SPEED = 1000;
const IMAGE_EDITOR_PT_BR = {
  id: "pt-BR",
  name: "Português (Brasil)",
  messages: {
    Save: "Salvar",
    "Save as": "Salvar como",
    "Failed to load the image": "Não foi possível carregar a imagem",
    Colour: "Cor",
    Font: "Fonte",
    "Add text": "Adicionar texto",
    Focus: "Foco",
    Radial: "Radial",
    Linear: "Linear",
    Intensity: "Intensidade",
    Radius: "Raio",
    "Zoom out": "Reduzir zoom",
    "Zoom in": "Aumentar zoom",
    Reset: "Redefinir",
    Undo: "Desfazer",
    Redo: "Refazer",
    Adjust: "Ajustar",
    Finetune: "Ajuste fino",
    Filters: "Filtros",
    Watermark: "Marca d'água",
    Annotate: "Anotar",
    Resize: "Redimensionar",
    Crop: "Recortar",
    Rotate: "Girar",
    "Flip X": "Inverter X",
    "Flip Y": "Inverter Y",
    Brightness: "Brilho",
    Contrast: "Contraste",
    Saturation: "Saturação",
    Blur: "Desfoque",
    Warmth: "Temperatura",
    Original: "Original",
    Invert: "Inverter cores",
    "Black & White": "Preto e branco",
    Sepia: "Sépia",
    Solarize: "Solarizar",
    Width: "Largura",
    Height: "Altura",
    px: "px",
    "Aspect ratio locked": "Proporção bloqueada",
    "Aspect ratio unlocked": "Proporção livre",
    "Reset size": "Redefinir tamanho",
    Size: "Tamanho",
    Left: "Esquerda",
    Center: "Centro",
    Right: "Direita",
    Delete: "Excluir",
    Text: "Texto",
    "Watermark text": "Texto da marca d'água",
    "Add watermark": "Adicionar marca d'água",
    "Reset all changes? You can still undo afterwards.": "Redefinir todas as alterações? Ainda será possível desfazer depois."
  }
};
const widthInput = byId("width");
const heightInput = byId("height");
const originInput = byId("origin");
const originButtons = [...document.querySelectorAll("[data-origin-corner]")];
function setOriginCorner(corner) {
  originInput.value = corner;
  for (const button of originButtons) {
    button.setAttribute("aria-checked", String(button.dataset.originCorner === corner));
  }
}
for (const button of originButtons) {
  button.addEventListener("click", () => {
    setOriginCorner(button.dataset.originCorner);
    originInput.dispatchEvent(new Event("change"));
  });
}
const startAnchorInput = byId("start-anchor");
const startAnchorButtons = [...document.querySelectorAll("[data-anchor-point]")];
function setStartAnchor(point) {
  startAnchorInput.value = point;
  for (const button of startAnchorButtons) {
    button.setAttribute("aria-checked", String(button.dataset.anchorPoint === point));
  }
}
for (const button of startAnchorButtons) {
  button.addEventListener("click", () => {
    setStartAnchor(button.dataset.anchorPoint);
    startAnchorInput.dispatchEvent(new Event("change"));
  });
}
const textInput = byId("text-content");
const fontFamilyInput = byId("font-family");
const fontSizeInput = byId("font-size");
const artboard = byId("artboard");
const stageBackgroundInput = byId("stage-background");
let storedStageBackground = STAGE_BACKGROUND_DEFAULT;
try { storedStageBackground = localStorage.getItem(STAGE_BACKGROUND_STORAGE_KEY) ?? STAGE_BACKGROUND_DEFAULT; } catch {}
stageBackgroundInput.value = normalizeStageBackground(storedStageBackground);
applyStageBackground(artboard, stageBackgroundInput.value);
stageBackgroundInput.addEventListener("input", () => {
  const color = normalizeStageBackground(stageBackgroundInput.value);
  applyStageBackground(artboard, color);
  try { localStorage.setItem(STAGE_BACKGROUND_STORAGE_KEY, color); } catch {}
});
const fontOptionsList = byId("font-family-options");
const fontListStatus = byId("font-list-status");

// Installed fonts need a user gesture and browser permission; the typed-name flow stays available either way.
async function loadSystemFonts() {
  const { status, families } = await listSystemFontFamilies(window);
  if (status !== "loaded") {
    fontListStatus.hidden = false;
    fontListStatus.textContent = i18n.t(status === "unsupported" ? "ui.creation.systemFontsUnsupported" : "ui.creation.systemFontsDenied");
    return;
  }
  fontListStatus.hidden = true;
  fontOptionsList.querySelectorAll("option[data-system-font]").forEach((option) => option.remove());
  for (const family of families) {
    const option = document.createElement("option");
    option.value = family;
    option.dataset.systemFont = "";
    fontOptionsList.append(option);
  }
}
byId("load-system-fonts").addEventListener("click", loadSystemFonts);

// Blank input falls back to the generic sans-serif family, matching the default in new projects.
function normalizeFontFamily(value) {
  return String(value ?? "").trim() || "sans-serif";
}

const boardFrame = byId("board-frame");
const stage = boardFrame.parentElement;
const zoomOutButton = byId("zoom-out");
const zoomInButton = byId("zoom-in");
const zoomResetButton = byId("zoom-reset");
const objects = byId("objects");
const removeButton = byId("remove-selection");
const selectionStatus = byId("selection-status");
const notice = byId("notice");
const noticeLog = byId("notice-log-text");
const projectNameInput = byId("project-name");
const saveStateBadge = byId("save-state");
const languageSelect = byId("language-select");
let projectNameIsUserValue = false;
const serialPathInput = byId("serial-path");
const connectButton = byId("connect-machine");
const disconnectButton = byId("disconnect-machine");
const simulateMachineButton = byId("simulate-machine");
const startMachineButton = byId("start-machine-job");
const machineJobControlButtons = [...document.querySelectorAll("[data-machine-job-control]")];
const MACHINE_POLL_INTERVAL_MS = 100;
const JOB_STOPPED_MESSAGE = "Job stopped; controller was reset";
const machineState = byId("machine-state");
let machineStateParts = [() => i18n.t("ui.machine.disconnected")];
const safetyCheckbox = byId("safety-confirmed");

let currentDocument = createDocument({ widthMm: 180, heightMm: 120 });
const generatedLayerNames = new Map([[currentDocument.layers[0].id, { kind: "engraving" }]]);
let selectedId = null;
let selectedIds = [];
let activeLayerId = currentDocument.layers[0].id;
let nextId = 1;
let copiedElements = [];
let pasteSequence = 0;
let activeTool = "select";
let imageVectorSourceId = null;
let imageVectorResult = null;
let imageVectorColors = new Set();
let imageVectorPreviewSequence = 0;
let imageTraceCancellation = null;
let rasterImageEditor = null;
let pendingImageEdit = null;
let noticeTimer;
let machineConnected = false;
let machineSimulation = false;
let machineBusy = false;
// Text objects whose font is not installed here; they block sending until the font is changed.
let missingFontElementIds = new Set();
let machineSimulationPlan = null;
let machineSimulationDocument = null;
let machineSimulationPlayback = [];
let machineSimulationCompletedLines = 0;
let machineSimulationCanvasSize = null;
let statusPollTimer;
let machineJobPaused = false;
let machineJobStopRequested = false;
let machineJobPollInFlight = false;
let machineSimulationLive = false;
let machineSimulationSimulated = true;
let machineSimulationFollowing = true;
let machineSimulationState = "running";
let machineSimulationTotal = 0;
let machineSimulationLiveLines = 0;
let machineSimulationTrack = [];
let machineSimulationCursor = 0;
let machineSimulationMatchedLine = 0;
let presentationActive = false;
let presentationSnapshot = null;
let presentationPaused = false;
let presentationRun = 0;
let presentationTarget = null;
let viewZoom = ZOOM_DEFAULT;

function applyInterfaceLocale() {
  document.documentElement.lang = i18n.locale;
  document.title = i18n.t("app.title");
  translateDom(document, i18n);
  languageSelect.value = i18n.locale;
  if (!projectNameIsUserValue) projectNameInput.value = i18n.t("app.unsavedProject");
  renderSaveState();
  toolbar.setTranslator(i18n.t);
  layersPanel?.setTranslator(i18n.t);
  renderDocumentTabs();
  renderActiveToolStatus();
  renderSelectionStatus();
  renderInspectorLocale();
  renderLayersForLocale();
  updateMachineControls();
  renderMachineState();
}
let presentationInternalClose = false;
let history = new DocumentHistory(currentDocument);
const documentTabs = [{ id: "tab-1", state: null }];
let activeDocumentTabId = "tab-1";
let documentTabSequence = 1;
const pathEditor = new PathEditor(byId("path-editor-dialog"));

function readDocument() {
  return createDocument({
    widthMm: Number(widthInput.value),
    heightMm: Number(heightInput.value),
    origin: { corner: originInput.value },
    layers: currentDocument.layers,
    elements: currentDocument.elements
  });
}

class FieldValidationError extends RangeError {
  constructor(input, result, label) {
    super(`${label} is invalid.`);
    this.code = `ui.validation.${result.code}`;
    this.input = input;
    this.result = result;
  }
}

function numberFrom(input, label, min = -Infinity) {
  const result = validateNumberField(input, { minimum: min });
  if (!result.valid) {
    showNumberFieldError(input, result, i18n.t, label);
    input.focus({ preventScroll: true });
    throw new FieldValidationError(input, result, label);
  }
  clearNumberFieldError(input);
  return result.value;
}

for (const input of document.querySelectorAll('input[type="number"]:not([data-layer-property])')) {
  input.addEventListener("input", () => {
    const result = validateNumberField(input);
    if (result.valid) clearNumberFieldError(input);
    else if (input.getAttribute("aria-invalid") === "true") showNumberFieldError(input, result, i18n.t);
  });
}

function commitHistory() {
  if (presentationActive) return;
  history.push(currentDocument);
  renderSaveState();
}

function hasUnsavedProjects() {
  return documentTabs.some((tab) => {
    const isActive = tab.id === activeDocumentTabId;
    const tabHistory = isActive ? history : tab.state?.history;
    const tabDocument = isActive ? currentDocument : tab.state?.document;
    return Boolean(tabHistory?.isDirty() && tabDocument?.elements?.length);
  });
}

function renderSaveState() {
  const dirty = history.isDirty();
  saveStateBadge.dataset.savedState = dirty ? "unsaved" : "saved";
  saveStateBadge.textContent = i18n.t(dirty ? "ui.canvas.unsavedBadge" : "ui.canvas.savedBadge");
  globalThis.commburnDesktop?.setUnsavedChanges?.({
    dirty: hasUnsavedProjects(),
    message: i18n.t("ui.unsaved.message"),
    leave: i18n.t("ui.unsaved.leave"),
    stay: i18n.t("ui.unsaved.stay")
  });
}

window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedProjects()) return;
  event.preventDefault();
  event.returnValue = "";
});

function formatMm(value) {
  return `${Number(value.toFixed(1))}`;
}

// Labels read machine coordinates: when machine zero sits on the far edge, the ruler counts back from it.
function renderRuler(container, lengthMm, vertical = false, zeroAtEnd = false) {
  container.replaceChildren();
  for (let index = 0; index <= 4; index += 1) {
    const mark = document.createElement("span");
    mark.className = "ruler-mark";
    const valueMm = zeroAtEnd ? lengthMm * (4 - index) / 4 : lengthMm * index / 4;
    mark.textContent = formatMm(valueMm) + (index === 4 ? " mm" : "");
    mark.style[vertical ? "top" : "left"] = `${index * 25}%`;
    container.append(mark);
  }
}

function resizeBoard(widthMm = currentDocument.widthMm, heightMm = currentDocument.heightMm) {
  const ratio = widthMm / heightMm;
  const availableWidth = Math.max(0, stage.clientWidth - 72);
  const stageVerticalPadding = 10 + 24;
  const topRulerHeight = 27;
  const availableHeight = Math.max(0, stage.clientHeight - stageVerticalPadding - topRulerHeight);
  const drawingWidth = Math.min(1100, availableWidth - 42, availableHeight * ratio) * viewZoom;
  boardFrame.style.width = `${Math.max(0, drawingWidth) + 42}px`;
  boardFrame.style.setProperty("--doc-ratio", `${widthMm} / ${heightMm}`);
}

function syncInspector() {
  const inspector = byId("object-inspector");
  const selectedElements = currentDocument.elements.filter((element) => selectedIds.includes(element.id));
  selectedIds = selectedElements.map((element) => element.id);
  selectedId = selectedIds.at(-1) ?? null;
  const selected = currentDocument.elements.find((element) => element.id === selectedId);
  const isMultiple = selectedElements.length > 1;
  inspector.hidden = selectedElements.length === 0;
  const { isText, isPath, isImage, isSvgImage } = getInspectorSections(selected);
  byId("text-inspector-fields").hidden = !isText;
  byId("path-inspector-fields").hidden = !isPath;
  byId("image-inspector-fields").hidden = !isImage;
  byId("svg-inspector-fields").hidden = !isSvgImage;
  byId("single-selection-fields").hidden = isMultiple;
  byId("multi-selection-message").hidden = !isMultiple;
  renderLayers();
  syncQuickProperties();
  if (!selected) return;
  if (isMultiple) {
    byId("inspector-kind").textContent = i18n.t("ui.inspector.selectedCount", { count: selectedElements.length });
    const hasLockedLayer = selectedElements.some((element) =>
      currentDocument.layers.find((layer) => layer.id === element.layerId)?.locked
    );
    removeButton.disabled = hasLockedLayer;
    byId("duplicate-selection").disabled = hasLockedLayer;
    return;
  }

  byId("inspector-kind").textContent = `${i18n.t(`ui.inspector.type.${selected.type}`)} · ${selected.id}`;
  byId("shape-properties").hidden = isText;
  byId("object-lock-ratio-field").hidden = isText;
  byId("object-text").value = isText ? selected.text : "";
  byId("object-font").value = selected.fontFamily ?? "sans-serif";
  byId("object-font-bold").checked = selected.fontWeight === "bold";
  byId("object-font-italic").checked = selected.fontStyle === "italic";
  const fontMissing = isText && missingFontElementIds.has(selected.id);
  byId("missing-font-hint").hidden = !fontMissing;
  byId("missing-font-hint").textContent = fontMissing ? i18n.t("ui.inspector.missingFont", { fontFamily: selected.fontFamily }) : "";
  byId("object-x").value = selected.xMm;
  byId("object-y").value = selected.yMm;
  byId("object-width").value = selected.widthMm ?? "";
  byId("object-height").value = selected.heightMm ?? "";
  const positiveDimensions = ["rect", "ellipse"].includes(selected.type);
  byId("object-width").min = positiveDimensions ? "0.1" : "0";
  byId("object-height").min = positiveDimensions ? "0.1" : "0";
  byId("object-rotation").value = selected.rotationDeg;
  byId("object-skew-x").value = selected.skewXDeg;
  byId("object-skew-y").value = selected.skewYDeg;
  const layerLocked = currentDocument.layers.find((layer) => layer.id === selected.layerId)?.locked ?? false;
  for (const input of inspector.querySelectorAll("input, textarea, select, button")) {
    input.disabled = layerLocked && input.id !== "object-layer";
  }
  byId("object-layer").replaceChildren(...currentDocument.layers.map((layer, index) => new Option(getLayerDisplayName(layer, index), layer.id)));
  byId("object-layer").value = selected.layerId;
  const imageLayer = currentDocument.layers.find((layer) => layer.id === selected.layerId);
  byId("open-image-vectorizer").disabled = !isImage || layerLocked;
  removeButton.disabled = layerLocked;
  byId("duplicate-selection").disabled = layerLocked;
}

function renderLayers() {
  const displayLayers = currentDocument.layers.map((layer, index) => ({
    ...layer,
    name: getLayerDisplayName(layer, index)
  }));
  layersPanel?.render(displayLayers, currentDocument.elements, activeLayerId);
  updateMachineControls();
}

function renderLayersForLocale() {
  const active = document.activeElement?.closest("#layers-list [data-layer-property]");
  const focusState = active ? {
    layerId: active.closest("[data-layer-id]")?.dataset.layerId,
    property: active.dataset.layerProperty,
    value: active.type === "checkbox" ? active.checked : active.value,
    selectionStart: active.type === "text" ? active.selectionStart : null,
    selectionEnd: active.type === "text" ? active.selectionEnd : null
  } : null;
  renderLayers();
  if (!focusState?.layerId) return;
  const replacement = [...layersPanel.root.querySelectorAll("[data-layer-property]")].find((control) =>
    control.dataset.layerProperty === focusState.property
      && control.closest("[data-layer-id]")?.dataset.layerId === focusState.layerId
  );
  if (!replacement) return;
  if (replacement.type === "checkbox") replacement.checked = focusState.value;
  else replacement.value = focusState.value;
  replacement.focus({ preventScroll: true });
  if (focusState.selectionStart !== null && replacement.type === "text") {
    replacement.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
  }
}

function renderInspectorLocale() {
  const selectedElements = currentDocument.elements.filter((element) => selectedIds.includes(element.id));
  const selected = selectedElements.at(-1);
  const kind = byId("inspector-kind");
  if (selectedElements.length > 1) {
    kind.textContent = i18n.t("ui.inspector.selectedCount", { count: selectedElements.length });
  } else if (selected) {
    kind.textContent = `${i18n.t(`ui.inspector.type.${selected.type}`)} · ${selected.id}`;
  } else {
    kind.textContent = i18n.t("ui.inspector.selected");
  }
  const layerSelect = byId("object-layer");
  const selectedLayerId = layerSelect.value;
  layerSelect.replaceChildren(...currentDocument.layers.map((layer, index) => new Option(getLayerDisplayName(layer, index), layer.id)));
  layerSelect.value = selectedLayerId;
}

function getLayerDisplayName(layer, index) {
  const generated = generatedLayerNames.get(layer.id);
  if (generated?.kind === "engraving") return i18n.t("ui.layers.defaultEngravingName");
  if (generated?.kind === "numbered") return i18n.t("ui.layers.defaultName", { index: index + 1 });
  if (generated?.kind === "copy") {
    const sourceIndex = currentDocument.layers.findIndex((candidate) => candidate.id === generated.sourceId);
    const source = currentDocument.layers[sourceIndex];
    const sourceMarker = source && generatedLayerNames.get(source.id);
    const sourceName = source && sourceMarker ? getLayerDisplayName(source, sourceIndex) : generated.sourceName;
    return `${i18n.t("ui.layers.copyName", { name: sourceName })}${generated.suffix ?? ""}`;
  }
  return layer.name;
}

function selectObject(id) {
  selectedIds = id ? [id] : [];
  selectedId = id;
  const selected = currentDocument.elements.find((element) => element.id === id);
  if (selected) activeLayerId = selected.layerId;
  syncInspector();
  renderPreview();
}

function changeSelection(ids) {
  selectedIds = [...new Set(ids)].filter((id) => currentDocument.elements.some((element) => element.id === id));
  selectedId = selectedIds.at(-1) ?? null;
  if (selectedIds.length === 1) {
    const selected = currentDocument.elements.find((element) => element.id === selectedId);
    if (selected) activeLayerId = selected.layerId;
  }
  syncInspector();
  renderPreview();
}

function selectObjectWithOptions(id, options = {}) {
  changeSelection(selectOne(selectedIds, id, options));
}

function selectObjects(ids, options = {}) {
  changeSelection(mergeSelection(selectedIds, ids, options));
}

function updateSelected(patch, saveHistory = true, refreshInspector = true) {
  const index = currentDocument.elements.findIndex((element) => element.id === selectedId);
  if (index < 0) return;
  try {
    const elements = currentDocument.elements.map((element, itemIndex) =>
      itemIndex === index ? { ...element, ...patch } : element
    );
    currentDocument = createDocument({ ...currentDocument, elements });
    if (refreshInspector) syncInspector();
    renderPreview();
    if (saveHistory) commitHistory();
  } catch (error) {
    showNotice(error);
  }
}

function updateMany(updates, saveHistory = true) {
  const patches = new Map(updates.map(({ id, patch }) => [id, patch]));
  try {
    for (const id of patches.keys()) {
      const element = currentDocument.elements.find((candidate) => candidate.id === id);
      if (!element) throw new RangeError(`Objeto selecionado não encontrado: ${id}`);
      if (currentDocument.layers.find((layer) => layer.id === element.layerId)?.locked) {
        throw new Error("Desbloqueie todas as camadas selecionadas antes de transformar os objetos.");
      }
    }
    const elements = currentDocument.elements.map((element) =>
      patches.has(element.id) ? { ...element, ...patches.get(element.id) } : element
    );
    currentDocument = createDocument({ ...readDocument(), elements });
    if (selectedIds.length === 1) syncInspector();
    renderPreview();
    if (saveHistory) commitHistory();
  } catch (error) {
    showNotice(error);
  }
}

function formatError(error) {
  if (error?.message === "Request body is too large") return i18n.t("ui.machine.requestTooLarge");
  return error?.code ? i18n.formatError(error) : error?.message ?? String(error);
}

function renderMachineState() {
  machineState.textContent = machineStateParts.map((renderPart) => renderPart()).join("");
}

function setMachineState(key, values = {}) {
  machineStateParts = [() => i18n.t(key, typeof values === "function" ? values() : values)];
  renderMachineState();
}

function setMachineStateText(text) {
  machineStateParts = [() => text];
  renderMachineState();
}

function appendMachineState(key, values = {}) {
  machineStateParts.push(() => ` ${i18n.t(key, typeof values === "function" ? values() : values)}`);
  renderMachineState();
}

function showNotice(message) {
  if (message instanceof FieldValidationError) {
    showNumberFieldError(message.input, message.result, i18n.t, message.message);
    message.input.focus({ preventScroll: true });
    return;
  }
  const text = message instanceof Error ? formatError(message) : message;
  notice.textContent = text;
  noticeLog.value = text;
  notice.classList.add("visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove("visible"), 3000);
}

// Native builds have no Node server; machine requests go to the USB serial plugin instead.
const nativeMachineApi = isNativeApp() ? createNativeMachineApi() : null;

async function machineApi(path, method = "GET", body) {
  if (nativeMachineApi) return nativeMachineApi(path, method, body);
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let result = null;
  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    result = null;
  }
  if (!response.ok) throw new Error(result?.error ?? `Machine request failed (${response.status})`);
  if (result === null) throw new Error(`Machine request returned no JSON (${response.status})`);
  return result;
}

function updateMachineControls() {
  const maxSpindleSpeed = Number(byId("machine-smax").value);
  const enabledLayers = currentDocument.layers.filter((layer) => layer.enabled);
  const settingsAreValid = (machineSimulation || (Number.isFinite(maxSpindleSpeed) && maxSpindleSpeed > 0))
    && enabledLayers.length > 0;
  connectButton.disabled = machineConnected;
  simulateMachineButton.disabled = machineConnected;
  disconnectButton.disabled = !machineConnected || machineBusy;
  serialPathInput.disabled = machineConnected;
  byId("baud-rate").disabled = machineConnected;
  byId("read-machine-settings").disabled = !machineConnected || machineSimulation || machineBusy;
  byId("read-machine-area").disabled = !machineConnected || machineSimulation || machineBusy;
  byId("machine-safety-check").hidden = machineSimulation;
  const fontBlocked = missingFontElementIds.size > 0;
  byId("missing-font-status").hidden = !fontBlocked;
  byId("missing-font-status").textContent = fontBlocked ? i18n.t("ui.machine.missingFontBlocked", { count: missingFontElementIds.size }) : "";
  simulateMachineButton.disabled ||= fontBlocked;
  startMachineButton.disabled = !machineConnected || (!machineSimulation && !safetyCheckbox.checked) || !settingsAreValid || machineBusy || fontBlocked;
  startMachineButton.textContent = i18n.t(machineSimulation ? "ui.machine.simulateJob" : "ui.machine.sendJob");
  const jobActive = machineConnected && machineBusy;
  const stopping = machineJobStopRequested;
  const jobEnabled = {
    pause: jobActive && !stopping && !machineJobPaused,
    resume: jobActive && !stopping && machineJobPaused,
    stop: jobActive && !stopping
  };
  for (const button of machineJobControlButtons) button.disabled = !jobEnabled[button.dataset.machineJobControl];
  byId("preview-machine-job").disabled = machineBusy;
  for (const id of ["read-position", "set-zero", "home-machine"]) byId(id).disabled = !machineConnected || machineBusy;
}

function renderSelectionStatus() {
  selectionStatus.textContent = selectedIds.length === 0
    ? i18n.t("ui.canvas.noSelection")
    : selectedIds.length === 1
      ? i18n.t("ui.canvas.selectionOne", { id: selectedId })
      : i18n.t("ui.canvas.selectionCount", { count: selectedIds.length });
}

function renderActiveToolStatus() {
  const tool = TOOLS.find((candidate) => candidate.id === activeTool);
  const button = byId("action-toolbar").querySelector(`[data-tool="${activeTool}"]`);
  const label = i18n.t(tool?.labelKey ?? "ui.tools.select.label");
  const key = button?.querySelector("kbd")?.textContent ?? "";
  byId("active-tool-status").textContent = i18n.t("ui.canvas.activeTool", { tool: label, key });
}

let controllerLaserMode = null;

function applyControllerSettings(settings) {
  const maxSpindleSpeed = settings?.$30;
  if (typeof maxSpindleSpeed !== "number" || !Number.isFinite(maxSpindleSpeed) || maxSpindleSpeed <= 0) return false;
  byId("machine-smax").value = String(maxSpindleSpeed);
  controllerLaserMode = settings?.$32 === 0 || settings?.$32 === 1 ? settings.$32 : null;
  return true;
}

function reportControllerSettings(result) {
  if (applyControllerSettings(result.settings)) {
    appendMachineState("ui.machine.settingsRead", { value: result.settings.$30 });
    updateMachineControls();
    return true;
  }
  const details = result.settingsError ?? i18n.t("ui.machine.settingsInvalid");
  const message = i18n.t("ui.machine.settingsFailure", { details });
    appendMachineState("ui.machine.settingsFailure", () => ({
      details: result.settingsError ?? i18n.t("ui.machine.settingsInvalid")
    }));
  showNotice(message);
  updateMachineControls();
  return false;
}

async function restoreMachineConnection() {
  if (nativeMachineApi) {
    simulateMachineButton.hidden = true;
  } else {
    // Static hosts without the Node server cannot control a machine, so the machine panel is not offered there.
    const probe = await fetch("/api/connection-status").catch(() => null);
    if (!probe || probe.status === 404) {
      byId("machine-panel").hidden = true;
      return;
    }
  }
  try {
    const state = await machineApi("/api/connection-status");
    machineConnected = state.connected;
    machineSimulation = state.simulated;
    machineBusy = state.busy;
    if (machineBusy) {
      setMachineState(machineSimulation ? "ui.machine.simulationRunning" : "ui.machine.jobRunning", {
        completed: state.jobStatus.completed,
        total: state.jobStatus.total
      });
      machineJobPaused = state.jobStatus.state === "paused";
      machineJobStopRequested = false;
      startMachinePolling();
      void pollMachineJob();
    } else if (machineConnected) {
      setMachineState(machineSimulation ? "ui.machine.simulatedConnected" : "ui.machine.connected");
      if (!machineSimulation && state.settings) applyControllerSettings(state.settings);
    }
    updateMachineControls();
    if (machineConnected && !machineSimulation && !machineBusy) {
      try {
        const result = await machineApi("/api/settings", "POST", {});
        reportControllerSettings(result);
      } catch (error) {
        reportControllerSettings({ settingsError: formatError(error) });
      }
    }
  } catch {
    setMachineState("ui.machine.disconnectedMode");
  }
}

async function refreshPorts() {
  const { ports, warning } = await machineApi("/api/ports");
  const options = byId("serial-port-options");
  options.replaceChildren(...ports.map((port) => {
    const option = document.createElement("option");
    option.value = port.path;
    option.label = [port.path, port.manufacturer].filter(Boolean).join(" — ");
    return option;
  }));
  if (warning) setMachineStateText(warning);
  else if (ports.length === 0) setMachineState("ui.machine.noPorts");
  return { warning };
}

async function pollMachineJob() {
  if (machineJobPollInFlight) return;
  machineJobPollInFlight = true;
  try {
    const result = await machineApi("/api/job-status");
    if (machineSimulationPlan) {
      renderMachineSimulationProgress(result.completed, result.total, result.state, result.position);
    }
    const paused = result.state === "paused";
    if (paused !== machineJobPaused) {
      machineJobPaused = paused;
      updateMachineControls();
    }
    if (result.state === "running" || paused) {
      const key = paused
        ? "ui.machine.jobPaused"
        : machineJobStopRequested
          ? "ui.machine.jobStopping"
          : machineSimulation ? "ui.machine.simulationRunning" : "ui.machine.jobRunning";
      setMachineState(key, { completed: result.completed, total: result.total });
      return;
    }
    clearInterval(statusPollTimer);
    statusPollTimer = undefined;
    machineBusy = false;
    const stopRequested = machineJobStopRequested;
    machineJobPaused = false;
    machineJobStopRequested = false;
    if (result.state === "complete") {
        setMachineState(machineSimulation ? "ui.machine.simulationComplete" : "ui.machine.jobComplete");
      showNotice(machineSimulation
        ? i18n.t("ui.machine.simulationComplete")
        : i18n.t("ui.machine.jobComplete"));
    } else if (result.state === "stopped" && stopRequested && result.error === JOB_STOPPED_MESSAGE) {
      setMachineState("ui.machine.jobStopped");
      showNotice(i18n.t("ui.machine.jobStopped"));
    } else if (result.state === "stopped") {
      setMachineState("ui.machine.sendInterrupted", () => ({ error: formatError(new Error(result.error)) }));
      showNotice(machineState.textContent);
    } else {
      setMachineState("ui.machine.connected");
    }
    updateMachineControls();
  } catch (error) {
    clearInterval(statusPollTimer);
    statusPollTimer = undefined;
    machineBusy = false;
    machineJobPaused = false;
    machineJobStopRequested = false;
    setMachineState("ui.machine.controllerFailure", () => ({ error: formatError(error) }));
    updateMachineControls();
  } finally {
    machineJobPollInFlight = false;
  }
}

function startMachinePolling() {
  clearInterval(statusPollTimer);
  statusPollTimer = setInterval(pollMachineJob, MACHINE_POLL_INTERVAL_MS);
}

async function controlMachineJob(action) {
  try {
    await machineApi(`/api/job-${action}`, "POST", {});
    if (action === "pause") {
      machineJobPaused = true;
      showNotice(i18n.t("ui.machine.pauseWarning"));
    } else if (action === "resume") {
      machineJobPaused = false;
    } else {
      machineJobStopRequested = true;
    }
    updateMachineControls();
    await pollMachineJob();
  } catch (error) {
    showNotice(error);
  }
}

byId("machine-timeline-play").addEventListener("click", toggleTimelinePlayback);
byId("machine-timeline-scrub").addEventListener("input", (event) => {
  stopTimelinePlayback();
  setTimelinePosition(Number(event.target.value));
});
byId("machine-preview-dialog").addEventListener("close", stopTimelinePlayback);
byId("machine-timeline-live").addEventListener("click", () => {
  stopTimelinePlayback();
  machineSimulationFollowing = true;
  if (!prepareMachineSimulationCanvases()) return;
  drawMachineSimulationTo(machineSimulationLiveLines);
  renderMachineSimulationView();
});
for (const button of machineJobControlButtons) {
  button.addEventListener("click", () => controlMachineJob(button.dataset.machineJobControl));
}

const SVG_NS = "http://www.w3.org/2000/svg";

let jobMarkersTimer = null;

// Planning the job is heavier than drawing, so markers are refreshed shortly after edits settle.
function renderJobMarkers(documentModel) {
  clearTimeout(jobMarkersTimer);
  jobMarkersTimer = setTimeout(() => keepScrollPositions(() => drawJobMarkers(documentModel)), 120);
}

// Redrawing the marker layer can make the browser re-anchor the page; restoring every scroll position keeps the view still.
function keepScrollPositions(action) {
  const containers = Array.from(document.querySelectorAll("*")).filter((element) => element.scrollTop || element.scrollLeft);
  const { scrollX, scrollY } = window;
  const positions = containers.map((element) => [element, element.scrollLeft, element.scrollTop]);
  action();
  if (window.scrollX !== scrollX || window.scrollY !== scrollY) window.scrollTo(scrollX, scrollY);
  for (const [element, left, top] of positions) {
    element.scrollLeft = left;
    element.scrollTop = top;
  }
}

// Rotated or skewed objects cannot be sent to GRBL yet, so only the visual extents and origin are shown.
function visualReference(documentModel) {
  const objectsLayer = byId("objects");
  if (!objectsLayer.hasChildNodes()) return null;
  const box = objectsLayer.getBBox();
  if (box.width <= 0 && box.height <= 0) return null;
  const frame = machineFrame(documentModel);
  return {
    bounds: {
      minXMm: Math.max(0, box.x), minYMm: Math.max(0, box.y),
      maxXMm: Math.min(documentModel.widthMm, box.x + box.width), maxYMm: Math.min(documentModel.heightMm, box.y + box.height)
    },
    origin: frame.originMm,
    xDirection: frame.xDirection,
    yDirection: frame.yDirection,
    start: null,
    end: null
  };
}

function drawJobMarkers(documentModel) {
  const layer = byId("job-markers");
  layer.replaceChildren();
  layer.style.opacity = "0.7";
  if (!byId("show-job-markers").checked) return;
  let reference;
  try {
    reference = jobReferencePoints(documentModel, { maxSpindleSpeed: SIMULATOR_MAX_SPINDLE_SPEED, ...readJobPlacement() });
  } catch {
    reference = visualReference(documentModel);
  }
  if (!reference) return;
  const size = Math.max(2, Math.max(documentModel.widthMm, documentModel.heightMm) / 50);
  const make = (name, attributes, text) => {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text) node.textContent = text;
    layer.append(node);
  };
  const label = (point, key, color, dx = 1.2, dy = -1.2) => make("text", {
    x: point.xMm + size * dx, y: point.yMm + size * dy, "font-size": size * 0.9, fill: color, "font-family": "sans-serif"
  }, i18n.t(key));
  const { origin, start, end, xDirection, yDirection, bounds } = reference;
  make("rect", { x: bounds.minXMm, y: bounds.minYMm, width: bounds.maxXMm - bounds.minXMm, height: bounds.maxYMm - bounds.minYMm, fill: "none", stroke: "#8a5a00", "stroke-width": size * 0.05, "stroke-dasharray": `${size * 0.15} ${size * 0.5}`, opacity: 0.45 });
  const arrow = (dx, dy, name) => {
    make("line", { x1: origin.xMm, y1: origin.yMm, x2: origin.xMm + dx * size * 2, y2: origin.yMm + dy * size * 2, stroke: "#8a5a00", "stroke-width": size * 0.12 });
    make("text", { x: origin.xMm + dx * size * 2.3, y: origin.yMm + dy * size * 2.3 + size * 0.3, "font-size": size * 0.8, fill: "#8a5a00", "font-family": "sans-serif", "text-anchor": "middle" }, name);
  };
  arrow(xDirection, 0, "X+");
  arrow(0, yDirection, "Y+");
  make("circle", { cx: origin.xMm, cy: origin.yMm, r: size * 0.35, fill: "#fff", stroke: "#8a5a00", "stroke-width": size * 0.12 });
  label(origin, "ui.canvas.markerOrigin", "#8a5a00", 0.6, xDirection === 1 && yDirection === 1 ? -0.6 : 1.4);
  if (start && end) {
    make("line", { x1: origin.xMm, y1: origin.yMm, x2: start.xMm, y2: start.yMm, stroke: "#8a5a00", "stroke-width": size * 0.05, "stroke-dasharray": `${size * 0.3} ${size * 0.3}`, opacity: 0.5 });
    make("circle", { cx: start.xMm, cy: start.yMm, r: size * 0.3, fill: "#1f9d55", stroke: "#fff", "stroke-width": size * 0.12 });
    label(start, "ui.canvas.markerStart", "#1f9d55");
    make("rect", { x: end.xMm - size * 0.28, y: end.yMm - size * 0.28, width: size * 0.56, height: size * 0.56, fill: "#d64545", stroke: "#fff", "stroke-width": size * 0.12 });
    label(end, "ui.canvas.markerEnd", "#d64545", 1.0, 1.8);
  }
}

// The origin only decides machine coordinates; the STAGE always shows the drawing the same way up.
const STAGE_ORIGIN = { corner: "top-left", flipX: false, flipY: false };

function renderPreview() {
  try {
    currentDocument = readDocument();
    const { widthMm, heightMm } = currentDocument;
    artboard.setAttribute("viewBox", `0 0 ${widthMm} ${heightMm}`);
    artboard.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const frame = machineFrame(currentDocument);
    renderRuler(byId("ruler-x"), widthMm, false, frame.originMm.xMm !== 0);
    renderRuler(byId("ruler-y"), heightMm, true, frame.originMm.yMm !== 0);
    resizeBoard(widthMm, heightMm);
    byId("canvas-size").textContent = `${widthMm} × ${heightMm} mm`;

    const svgDocument = new DOMParser().parseFromString(renderSvg({ ...currentDocument, origin: STAGE_ORIGIN }), "image/svg+xml");
    if (svgDocument.querySelector("parsererror")) throw new Error("Não foi possível desenhar este documento.");
    missingFontElementIds = new Set(
      currentDocument.elements
        .filter((element) => element.type === "text" && !isFontInstalled(element.fontFamily))
        .map((element) => element.id)
    );
    const selection = new Set(selectedIds);
    const nodes = Array.from(svgDocument.querySelectorAll("[id]"), (node) => {
      const nodeId = node.getAttribute("id");
      const imported = document.importNode(node, true);
      imported.dataset.id = nodeId;
      imported.dataset.layerId = node.closest("[data-layer-id]")?.getAttribute("data-layer-id") ?? "";
      const layer = currentDocument.layers.find((candidate) => candidate.id === imported.dataset.layerId);
      if (layer?.locked) imported.dataset.locked = "true";
      if (missingFontElementIds.has(nodeId)) {
        // Shown with a generic face so the text stays visible while it blinks.
        imported.classList.add("missing-font");
        imported.setAttribute("font-family", "sans-serif");
      }
      if (selection.has(imported.dataset.id)) imported.classList.add("selected");
      return imported;
    });
    objects.replaceChildren(...nodes);
    renderJobMarkers(currentDocument);
    renderSelectionStatus();
    const selected = currentDocument.elements.filter((element) => selectedIds.includes(element.id));
    const hasLockedLayer = selected.some((element) =>
      currentDocument.layers.find((layer) => layer.id === element.layerId)?.locked
    );
    removeButton.disabled = selected.length === 0 || hasLockedLayer;
    byId("duplicate-selection").disabled = selected.length === 0 || hasLockedLayer;
    renderLayers();
    updateMachineControls();
  } catch (error) {
    showNotice(error);
  }
}

function addText() {
  const baseDocument = readDocument();
  const layer = baseDocument.layers.find((candidate) => candidate.id === activeLayerId);
  if (!layer || layer.locked) throw new Error("Selecione uma camada desbloqueada para adicionar objetos.");
  const element = {
    id: `texto-${nextId++}`,
    type: "text",
    text: textInput.value || "Seu texto",
    fontFamily: normalizeFontFamily(fontFamilyInput.value),
    fontWeight: byId("new-font-bold").checked ? "bold" : "normal",
    fontStyle: byId("new-font-italic").checked ? "italic" : "normal",
    xMm: numberFrom(byId("new-x"), "Posição X"),
    yMm: numberFrom(byId("new-y"), "Posição Y"),
    fontSizeMm: numberFrom(fontSizeInput, "Tamanho do texto", Number.MIN_VALUE),
    rotationDeg: 0,
    skewXDeg: 0,
    skewYDeg: 0,
    layerId: activeLayerId
  };
  currentDocument = createDocument({ ...baseDocument, elements: [...baseDocument.elements, element] });
  selectedIds = [element.id];
  selectedId = element.id;
  syncInspector();
  renderPreview();
  commitHistory();
}

function addShape() {
  const baseDocument = readDocument();
  const layer = baseDocument.layers.find((candidate) => candidate.id === activeLayerId);
  if (!layer || layer.locked) throw new Error("Selecione uma camada desbloqueada para adicionar objetos.");
  const type = byId("new-shape-type").value;
  const element = {
    id: `${type}-${nextId++}`,
    type,
    xMm: numberFrom(byId("new-x"), "Posição X"),
    yMm: numberFrom(byId("new-y"), "Posição Y"),
    widthMm: numberFrom(byId("new-shape-width"), "Largura", type === "line" ? 0 : Number.MIN_VALUE),
    heightMm: numberFrom(byId("new-shape-height"), "Altura", type === "line" ? 0 : Number.MIN_VALUE),
    rotationDeg: 0,
    skewXDeg: 0,
    skewYDeg: 0,
    layerId: activeLayerId
  };
  if (type === "line" && element.widthMm === 0 && element.heightMm === 0) {
    throw new RangeError("A linha precisa ter comprimento maior que zero.");
  }
  currentDocument = createDocument({ ...baseDocument, elements: [...baseDocument.elements, element] });
  selectedIds = [element.id];
  selectedId = element.id;
  syncInspector();
  renderPreview();
  commitHistory();
}

function getProjectFilename(extension) {
  const baseName = projectNameInput.value.trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "");
  return `${baseName || "Trabalho sem título"}.${extension}`;
}

function exportSvg() {
  const svg = renderSvg(readDocument());
  downloadFile(svg, getProjectFilename("svg"), "image/svg+xml;charset=utf-8");
  showNotice("SVG exportado com medidas em milímetros.");
}

function downloadFile(contents, filename, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveProject() {
  const saveHistory = history;
  const contents = serializeProject(readDocument());
  const suggestedName = getProjectFilename("commburn.json");
  const desktop = globalThis.commburnDesktop;
  if (desktop?.saveProject) {
    const currentPath = saveHistory.fileTarget?.path ?? null;
    const savedPath = await desktop.saveProject({ contents, suggestedName, filePath: currentPath });
    if (!savedPath) return;
    saveHistory.markSaved({ path: savedPath });
  } else if (typeof globalThis.showSaveFilePicker === "function") {
    try {
      let handle = saveHistory.fileTarget?.handle;
      if (!handle) {
        handle = await globalThis.showSaveFilePicker({
          suggestedName,
          types: [{ description: "CommBurn", accept: { "application/json": [".json"] } }]
        });
      }
      const mode = { mode: "readwrite" };
      if (await handle.queryPermission(mode) !== "granted" && await handle.requestPermission(mode) !== "granted") {
        throw new Error("Permissão de escrita negada para o arquivo do projeto.");
      }
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
      saveHistory.markSaved({ handle });
    } catch (error) {
      if (error?.name === "AbortError") return;
      throw error;
    }
  } else {
    downloadFile(contents, suggestedName, "application/json;charset=utf-8");
    saveHistory.markSaved(saveHistory.fileTarget);
  }
  renderSaveState();
  showNotice("Projeto editável salvo com camadas e objetos.");
}

function machineMaxSpindleSpeed(allowDefaultSmax = false) {
  const inputValue = Number(byId("machine-smax").value);
  if (Number.isFinite(inputValue) && inputValue > 0) return inputValue;
  if (allowDefaultSmax) return SIMULATOR_MAX_SPINDLE_SPEED;
  return numberFrom(byId("machine-smax"), "Velocidade máxima S", Number.MIN_VALUE);
}

const rasterCache = new Map();

async function decodeImageGray(element, spacingMm) {
  const widthPx = Math.max(1, Math.min(2000, Math.round(element.widthMm / spacingMm)));
  const heightPx = Math.max(1, Math.min(2000, Math.round(element.heightMm / spacingMm)));
  const key = `${element.id}|${element.imageDataUri.length}|${widthPx}x${heightPx}`;
  if (rasterCache.has(key)) return { key, raster: rasterCache.get(key) };
  const image = new Image();
  image.src = element.imageDataUri;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, widthPx, heightPx);
  context.drawImage(image, 0, 0, widthPx, heightPx);
  const { data } = context.getImageData(0, 0, widthPx, heightPx);
  const gray = new Uint8Array(widthPx * heightPx);
  for (let index = 0; index < gray.length; index += 1) {
    gray[index] = Math.round(0.299 * data[index * 4] + 0.587 * data[index * 4 + 1] + 0.114 * data[index * 4 + 2]);
  }
  let binary = "";
  for (let index = 0; index < gray.length; index += 8192) binary += String.fromCharCode(...gray.subarray(index, index + 8192));
  const raster = { widthPx, heightPx, gray: btoa(binary) };
  rasterCache.set(key, raster);
  return { key, raster };
}

let currentRasters = {};

async function prepareRasters(documentModel = readDocument()) {
  const rasters = {};
  for (const element of documentModel.elements) {
    if (element.type !== "image") continue;
    const layer = documentModel.layers.find(({ id }) => id === element.layerId);
    if (!layer?.enabled) continue;
    try {
      rasters[element.id] = (await decodeImageGray(element, Math.max(0.05, layer.fillSpacingMm))).raster;
    } catch {
      // The planner reports the unsupported image with its stable error code.
    }
  }
  currentRasters = rasters;
}

function readJobPlacement() {
  const workCoordinateSystem = byId("work-system").value;
  return {
    rasters: currentRasters,
    imageMode: byId("image-mode").value,
    ...jobStartSettings(byId("start-mode").value, byId("start-anchor").value),
    ...(workCoordinateSystem ? { workCoordinateSystem } : {})
  };
}

function createMachinePlan({ allowDefaultSmax = false, documentModel = readDocument() } = {}) {
  return planGrblJob(documentModel, {
    maxSpindleSpeed: machineMaxSpindleSpeed(allowDefaultSmax),
    controllerLaserMode,
    ...readJobPlacement()
  });
}

function updateMachinePreviewStats(plan) {
  const stats = plan.stats;
  byId("machine-preview-stats").textContent =
    `${stats.workPathCount} trajetórias de trabalho · ${stats.rapidMoveCount} saltos rápidos · `
    + `${stats.workDistanceMm.toFixed(1)} mm de trabalho · ${stats.travelDistanceMm.toFixed(1)} mm de deslocamento conhecido`;
  byId("machine-preview-time").textContent =
    formatOperationTimeEstimates(stats.estimatedWorkTimeSecondsByOperation);
  byId("machine-preview-code").textContent = plan.gcode;
}

function drawMachinePreview(machinePlan, documentModel = readDocument()) {
  const plan = planToDocumentSpace(documentModel, machinePlan);
  const svg = byId("machine-path-preview");
  svg.setAttribute("viewBox", `0 0 ${documentModel.widthMm} ${documentModel.heightMm}`);
  svg.style.aspectRatio = `${documentModel.widthMm} / ${documentModel.heightMm}`;
  svg.replaceChildren();
  const layersById = new Map(documentModel.layers.map((layer) => [layer.id, layer]));
  const rasterPaths = plan.paths.filter((path) => path.segmentPowerFractions);
  const intensityBuckets = new Map();
  for (const rasterPath of rasterPaths) {
    const layer = layersById.get(rasterPath.layerId);
    rasterPath.segmentPowerFractions.forEach((fraction, index) => {
      if (fraction <= 0) return;
      const key = `${layer.id}|${fraction}`;
      if (!intensityBuckets.has(key)) intensityBuckets.set(key, { layer, fraction, d: [] });
      const [a, b] = [rasterPath.points[index], rasterPath.points[index + 1]];
      intensityBuckets.get(key).d.push(`M${a.xMm} ${a.yMm}L${b.xMm} ${b.yMm}`);
    });
  }
  for (const { layer, fraction, d } of intensityBuckets.values()) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d.join(""));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", layer.color);
    path.setAttribute("stroke-opacity", String(Math.max(0.05, fraction)));
    path.setAttribute("stroke-width", String(Math.max(0.05, layer.fillSpacingMm)));
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `Intensidade do laser: ${Math.round(fraction * 100)}% · ${layer.name}`;
    path.append(title);
    svg.append(path);
  }
  for (const plannedPath of groupMachinePreviewPaths(plan.paths.filter((path) => !path.segmentPowerFractions))) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", plannedPath.pathData);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", plannedPath.kind === "travel" ? "#8994a4" : layersById.get(plannedPath.layerId).color);
    path.setAttribute("stroke-width", plannedPath.kind === "travel" ? "0.35" : "0.6");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    if (plannedPath.kind === "travel") path.setAttribute("stroke-dasharray", "3 2");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = plannedPath.kind === "travel"
      ? "Deslocamento rápido entre trajetórias; laser desligado"
      : `Trajetórias de trabalho · ${layersById.get(plannedPath.layerId).name}`;
    path.append(title);
    svg.append(path);
  }
  updateMachinePreviewStats(plan);
}

function machineSimulationCanvasDimensions() {
  const visual = byId("machine-simulation-visual");
  const rect = visual.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const pixelRatio = window.devicePixelRatio || 1;
  return {
    width: rect.width,
    height: rect.height,
    pixelRatio,
    pixelWidth: Math.max(1, Math.round(rect.width * pixelRatio)),
    pixelHeight: Math.max(1, Math.round(rect.height * pixelRatio))
  };
}

function prepareMachineSimulationCanvases() {
  const dimensions = machineSimulationCanvasDimensions();
  if (!dimensions) return false;
  const resized = !machineSimulationCanvasSize
    || dimensions.pixelWidth !== machineSimulationCanvasSize.pixelWidth
    || dimensions.pixelHeight !== machineSimulationCanvasSize.pixelHeight;
  if (!resized) return true;

  machineSimulationCanvasSize = dimensions;
  for (const id of ["machine-simulation-plan", "machine-simulation-playback"]) {
    const canvas = byId(id);
    canvas.width = dimensions.pixelWidth;
    canvas.height = dimensions.pixelHeight;
  }
  drawMachineSimulationPlan();
  machineSimulationCompletedLines = 0;
  return true;
}

function setupMachineSimulationContext(canvas, { clear = true } = {}) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("O navegador não disponibilizou o canvas da simulação visual.");
  const dimensions = machineSimulationCanvasSize;
  context.setTransform(dimensions.pixelRatio, 0, 0, dimensions.pixelRatio, 0, 0);
  if (clear) context.clearRect(0, 0, dimensions.width, dimensions.height);
  const documentModel = machineSimulationDocument;
  const scale = Math.min(
    (dimensions.width - 24) / documentModel.widthMm,
    (dimensions.height - 24) / documentModel.heightMm
  );
  const offsetX = (dimensions.width - documentModel.widthMm * scale) / 2;
  const offsetY = (dimensions.height - documentModel.heightMm * scale) / 2;
  context.save();
  context.translate(offsetX, offsetY);
  context.scale(scale, scale);
  context.lineCap = "round";
  context.lineJoin = "round";
  return { context, scale };
}

function drawMachineSimulationPlan() {
  const canvas = byId("machine-simulation-plan");
  const { context, scale } = setupMachineSimulationContext(canvas);
  const { widthMm, heightMm } = machineSimulationDocument;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, widthMm, heightMm);
  context.beginPath();
  context.strokeStyle = "#cbd5e1";
  context.lineWidth = 0.6 / scale;
  context.rect(0, 0, widthMm, heightMm);
  context.stroke();

  context.beginPath();
  context.strokeStyle = "#b8c4d4";
  context.lineWidth = 0.55 / scale;
  context.setLineDash([]);
  for (const path of machineSimulationPlan.paths) {
    if (path.kind !== "work") continue;
    context.moveTo(path.points[0].xMm, path.points[0].yMm);
    for (const point of path.points.slice(1)) context.lineTo(point.xMm, point.yMm);
  }
  context.stroke();

  context.beginPath();
  context.strokeStyle = "#8793a3";
  context.lineWidth = 0.4 / scale;
  context.setLineDash([3 / scale, 2 / scale]);
  for (const path of machineSimulationPlan.paths) {
    if (path.kind !== "travel") continue;
    context.moveTo(path.points[0].xMm, path.points[0].yMm);
    for (const point of path.points.slice(1)) context.lineTo(point.xMm, point.yMm);
  }
  context.stroke();
  context.setLineDash([]);
  context.restore();
}

function drawMachineSimulationSegments(segments) {
  if (segments.length === 0) return;
  const canvas = byId("machine-simulation-playback");
  const { context, scale } = setupMachineSimulationContext(canvas, { clear: false });
  const layersById = new Map(machineSimulationDocument.layers.map((layer) => [layer.id, layer]));
  for (const kind of ["work", "travel"]) {
    const grouped = new Map();
    for (const segment of segments) {
      if (segment.kind !== kind) continue;
      if (segment.fraction === 0) continue;
      const color = kind === "travel" ? "#626f80" : layersById.get(segment.layerId).color;
      const key = segment.fraction === undefined ? color : `${color}|${segment.fraction}|${layersById.get(segment.layerId).fillSpacingMm}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(segment);
    }
    for (const [key, paths] of grouped) {
      const [color, fraction, spacing] = key.split("|");
      context.beginPath();
      context.strokeStyle = color;
      context.globalAlpha = fraction === undefined ? 1 : Math.max(0.05, Number(fraction));
      context.lineWidth = fraction === undefined ? (kind === "work" ? 1.4 : 0.9) / scale : Math.max(0.05, Number(spacing));
      context.setLineDash(kind === "travel" ? [3 / scale, 2 / scale] : []);
      for (const path of paths) {
        context.moveTo(path.points[0].xMm, path.points[0].yMm);
        context.lineTo(path.points.at(-1).xMm, path.points.at(-1).yMm);
      }
      context.stroke();
      context.globalAlpha = 1;
    }
  }
  context.setLineDash([]);
  context.restore();
}

// Draws the playback layer up to a line. Rewinding clears the layer and redraws from the start.
function drawMachineSimulationTo(target) {
  const lines = Math.max(0, Math.min(target, machineSimulationTotal));
  if (lines < machineSimulationCompletedLines) {
    byId("machine-simulation-playback").width = machineSimulationCanvasSize.pixelWidth;
    byId("machine-simulation-playback").height = machineSimulationCanvasSize.pixelHeight;
    machineSimulationCompletedLines = 0;
  }
  const segments = getMachinePlaybackSegments(
    machineSimulationPlayback,
    machineSimulationCompletedLines,
    lines
  );
  drawMachineSimulationSegments(segments);
  machineSimulationCompletedLines = lines;
}

// Live job progress: the view follows it unless the operator is reviewing earlier commands.
// Acknowledged lines run ahead of motion, so when the head position is known the drawing stops at the head.
function renderMachineSimulationProgress(completed, total, state, position = null) {
  if (!machineSimulationPlan || !prepareMachineSimulationCanvases()) return;
  machineSimulationTotal = Math.max(0, total);
  machineSimulationState = state;
  machineSimulationLiveLines = Math.max(0, Math.min(completed, machineSimulationTotal));
  if (position && state !== "complete" && machineSimulationTrack.length > 0) {
    const match = locateMachinePosition(machineSimulationTrack, position, machineSimulationCursor);
    if (match) {
      machineSimulationCursor = match.index;
      machineSimulationMatchedLine = Math.max(machineSimulationMatchedLine, match.line);
    }
    machineSimulationLiveLines = Math.min(machineSimulationLiveLines, machineSimulationMatchedLine);
  }
  if (machineSimulationFollowing) drawMachineSimulationTo(machineSimulationLiveLines);
  renderMachineSimulationView();
}

function renderMachineSimulationView() {
  const completedLines = Math.floor(machineSimulationCompletedLines);
  const percent = machineSimulationTotal > 0 ? Math.floor(completedLines / machineSimulationTotal * 100) : 0;
  const progress = byId("machine-simulation-progress");
  progress.max = Math.max(1, machineSimulationTotal);
  progress.value = completedLines;
  const scrub = byId("machine-timeline-scrub");
  scrub.max = String(Math.max(1, machineSimulationTotal));
  scrub.value = String(completedLines);
  byId("machine-timeline-live").hidden = !machineSimulationLive || machineSimulationFollowing;
  let statusKey;
  if (machineSimulationLive && !machineSimulationFollowing) {
    statusKey = "ui.dialogs.reviewStatus";
  } else if (machineSimulationState === "paused") {
    statusKey = "ui.dialogs.pausedStatus";
  } else if (!machineSimulationSimulated) {
    statusKey = "ui.dialogs.jobProgressStatus";
  } else if (machineSimulationState === "complete") {
    statusKey = "ui.dialogs.simulationCompleteStatus";
  } else if (machineSimulationState === "stopped") {
    statusKey = "ui.dialogs.simulationStoppedStatus";
  } else {
    statusKey = "ui.dialogs.simulationProgressStatus";
  }
  byId("machine-simulation-status").textContent = i18n.t(statusKey, {
    completed: completedLines,
    total: machineSimulationTotal,
    percent,
    live: Math.floor(machineSimulationLiveLines)
  });
}

function showMachineSimulation(machinePlan, documentModel, totalLines, { live = false, simulated = true } = {}) {
  const plan = planToDocumentSpace(documentModel, machinePlan);
  machineSimulationPlan = plan;
  machineSimulationDocument = documentModel;
  machineSimulationPlayback = createMachinePlayback(plan).entries;
  machineSimulationTrack = createMachineTrack(machinePlan);
  machineSimulationCursor = 0;
  machineSimulationMatchedLine = 0;
  machineSimulationCompletedLines = 0;
  machineSimulationCanvasSize = null;
  machineSimulationLive = live;
  machineSimulationSimulated = simulated;
  machineSimulationFollowing = true;
  const dialog = byId("machine-preview-dialog");
  byId("machine-preview-title").textContent = i18n.t(simulated ? "ui.dialogs.machineSimulationTitle" : "ui.dialogs.machineJobTitle");
  byId("machine-preview-description").textContent = i18n.t(simulated ? "ui.dialogs.machineSimulationDescription" : "ui.dialogs.machineJobDescription");
  byId("machine-simulation-panel").hidden = false;
  byId("machine-timeline").hidden = !live;
  byId("machine-simulation-job-controls").hidden = !live;
  stopTimelinePlayback();
  byId("machine-path-preview").toggleAttribute("hidden", true);
  updateMachinePreviewStats(plan);
  if (!dialog.open) dialog.showModal();
  renderMachineSimulationProgress(0, totalLines, "running");
}

let timelineTimer = null;

function stopTimelinePlayback() {
  clearInterval(timelineTimer);
  timelineTimer = null;
  byId("machine-timeline-play").textContent = i18n.t("ui.dialogs.timelinePlay");
}

function setTimelinePosition(value) {
  if (!prepareMachineSimulationCanvases()) return;
  machineSimulationFollowing = false;
  drawMachineSimulationTo(value);
  renderMachineSimulationView();
}

function toggleTimelinePlayback() {
  if (timelineTimer) return stopTimelinePlayback();
  const scrub = byId("machine-timeline-scrub");
  const total = Number(scrub.max);
  if (Number(scrub.value) >= total) setTimelinePosition(0);
  const step = Math.max(1, Math.ceil(total / 240));
  byId("machine-timeline-play").textContent = i18n.t("ui.dialogs.timelinePause");
  timelineTimer = setInterval(() => {
    const next = Math.min(total, Number(scrub.value) + step);
    setTimelinePosition(next);
    if (next >= total) stopTimelinePlayback();
  }, 25);
}

function showTimelinePreview(plan, documentModel) {
  const total = createMachinePlayback(plan).totalLines;
  showMachineSimulation(plan, documentModel, total);
  const scrub = byId("machine-timeline-scrub");
  scrub.max = String(Math.max(1, total));
  byId("machine-timeline").hidden = false;
  byId("machine-preview-title").textContent = i18n.t("ui.dialogs.machinePreview");
  byId("machine-preview-description").textContent = i18n.t("ui.dialogs.machinePreviewDescription");
  stopTimelinePlayback();
  setTimelinePosition(total);
}

async function showMachinePreview() {
  try {
    await prepareRasters();
    const referenceDocument = readDocument();
    const documentModel = presentationActive
      ? createPresentationSimulationDocument(referenceDocument)
      : referenceDocument;
    const plan = presentationActive
      ? planGrblJob(documentModel, { maxSpindleSpeed: SIMULATOR_MAX_SPINDLE_SPEED })
      : createMachinePlan({ allowDefaultSmax: true, documentModel });
    drawMachinePreview(plan, documentModel);
    if (!presentationActive) {
      showTimelinePreview(plan, documentModel);
      return;
    }
    byId("machine-timeline").hidden = true;
    byId("machine-preview-title").textContent = i18n.t("ui.dialogs.machinePreview");
    byId("machine-preview-description").textContent = i18n.t("ui.dialogs.machinePreviewDescription");
    byId("machine-simulation-panel").hidden = true;
    byId("machine-path-preview").toggleAttribute("hidden", false);
    byId("machine-preview-dialog").showModal();
  } catch (error) {
    showNotice(error instanceof FieldValidationError
      ? error
      : i18n.t("ui.dialogs.machinePreviewFailure", { error: formatError(error) }));
  }
}

function presentationUi() {
  return {
    card: byId("presentation-card"),
    cursor: byId("presentation-cursor"),
    dialog: byId("machine-preview-dialog")
  };
}

function movePresentationUi(parent) {
  const { card, cursor } = presentationUi();
  parent.append(card, cursor);
}

function setPresentationInput(input, value) {
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setPresentationStep(index, title, description, total = PRESENTATION_STEPS.length) {
  byId("presentation-step-count").textContent = `${index} / ${total}`;
  byId("presentation-step-label").textContent = i18n.t("ui.presentation.label");
  byId("presentation-title").textContent = title;
  byId("presentation-description").textContent = description;
  byId("presentation-progress").max = total;
  byId("presentation-progress").value = index;
}

function presentationCurrent(run) {
  return presentationActive && run === presentationRun;
}

function waitPresentation(milliseconds, run) {
  return new Promise((resolve) => {
    let remaining = milliseconds;
    const interval = setInterval(() => {
      if (!presentationCurrent(run)) {
        clearInterval(interval);
        resolve(false);
      } else if (!presentationPaused) {
        remaining -= 40;
        if (remaining <= 0) {
          clearInterval(interval);
          resolve(true);
        }
      }
    }, 40);
  });
}

async function movePresentationCursor(target, run) {
  if (!target) throw new RangeError("O alvo da etapa da apresentação não existe.");
  if (!presentationCurrent(run)) return false;
  target.scrollIntoView({ block: "center", behavior: "auto" });
  presentationTarget?.classList.remove("presentation-target");
  presentationTarget = target;
  target.classList.add("presentation-target");
  const bounds = target.getBoundingClientRect();
  const { cursor } = presentationUi();
  cursor.style.left = `${bounds.left + Math.min(bounds.width / 2, 30) - 3}px`;
  cursor.style.top = `${bounds.top + Math.min(bounds.height / 2, 20) - 2}px`;
  if (!await waitPresentation(650, run)) return false;
  cursor.classList.add("is-clicking");
  const clicked = await waitPresentation(180, run);
  cursor.classList.remove("is-clicking");
  return clicked;
}

function savePresentationState() {
  return {
    currentDocument,
    selectedId,
    selectedIds: [...selectedIds],
    activeLayerId,
    nextId,
    activeTool,
    values: {
      width: widthInput.value,
      height: heightInput.value,
      origin: originInput.value,
      text: textInput.value,
      fontFamily: normalizeFontFamily(fontFamilyInput.value),
      fontBold: byId("new-font-bold").checked,
      fontItalic: byId("new-font-italic").checked,
      newX: byId("new-x").value,
      newY: byId("new-y").value,
      shapeType: byId("new-shape-type").value,
      shapeWidth: byId("new-shape-width").value,
      shapeHeight: byId("new-shape-height").value
    },
    machineSimulationPlan,
    machineSimulationDocument,
    machineSimulationPlayback,
    machineSimulationCompletedLines,
    machineSimulationCanvasSize,
    scroll: {
      windowX: window.scrollX,
      windowY: window.scrollY,
      containers: [...document.querySelectorAll(".sidebar, .stage, #machine-preview-dialog")]
        .map((element) => ({ element, left: element.scrollLeft, top: element.scrollTop }))
    }
  };
}

function restorePresentationState() {
  const saved = presentationSnapshot;
  if (!saved) return;
  currentDocument = saved.currentDocument;
  selectedId = saved.selectedId;
  selectedIds = saved.selectedIds;
  activeLayerId = saved.activeLayerId;
  nextId = saved.nextId;
  widthInput.value = saved.values.width;
  heightInput.value = saved.values.height;
  setOriginCorner(saved.values.origin);
  textInput.value = saved.values.text;
  fontFamilyInput.value = saved.values.fontFamily;
  byId("new-font-bold").checked = saved.values.fontBold;
  byId("new-font-italic").checked = saved.values.fontItalic;
  fontSizeInput.value = saved.values.fontSize;
  byId("new-x").value = saved.values.newX;
  byId("new-y").value = saved.values.newY;
  byId("new-shape-type").value = saved.values.shapeType;
  byId("new-shape-type").dispatchEvent(new Event("change", { bubbles: true }));
  byId("new-shape-width").value = saved.values.shapeWidth;
  byId("new-shape-height").value = saved.values.shapeHeight;
  machineSimulationPlan = saved.machineSimulationPlan;
  machineSimulationDocument = saved.machineSimulationDocument;
  machineSimulationPlayback = saved.machineSimulationPlayback;
  machineSimulationCompletedLines = saved.machineSimulationCompletedLines;
  machineSimulationCanvasSize = saved.machineSimulationCanvasSize;
  toolbar.setTool(saved.activeTool);
  syncInspector();
  renderPreview();
  window.scrollTo(saved.scroll.windowX, saved.scroll.windowY);
  for (const position of saved.scroll.containers) {
    if (!position.element.isConnected) continue;
    position.element.scrollLeft = position.left;
    position.element.scrollTop = position.top;
  }
  presentationSnapshot = null;
}

function finishPresentation() {
  if (!presentationActive) return;
  presentationRun += 1;
  presentationActive = false;
  presentationPaused = false;
  document.body.classList.remove("presentation-active");
  document.documentElement.classList.remove("presentation-active");
  const { card, cursor, dialog } = presentationUi();
  presentationTarget?.classList.remove("presentation-target");
  presentationTarget = null;
  setPresentationSubstepText("");
  movePresentationUi(document.body);
  card.hidden = true;
  cursor.hidden = true;
  if (dialog.open) {
    presentationInternalClose = true;
    dialog.close();
  }
  restorePresentationState();
}

function resetPresentationDemo() {
  const { card, dialog } = presentationUi();
  if (dialog.open) {
    presentationInternalClose = true;
    dialog.close();
  }
  movePresentationUi(document.body);
  card.hidden = false;
  presentationUi().cursor.hidden = false;
  presentationTarget?.classList.remove("presentation-target");
  presentationTarget = null;
  presentationUi().cursor.classList.remove("is-clicking");
  setPresentationSubstepText("");
  currentDocument = createPresentationDocument();
  selectedId = null;
  selectedIds = [];
  activeLayerId = currentDocument.layers[0].id;
  nextId = 1;
  toolbar.setTool("select");
  widthInput.value = String(currentDocument.widthMm);
  heightInput.value = String(currentDocument.heightMm);
  setOriginCorner(currentDocument.origin.corner);
  syncInspector();
  renderPreview();
}

async function animatePresentationSimulation(run) {
  const totalLines = createMachinePlayback(machineSimulationPlan).totalLines;
  const durationMs = 5200;
  let elapsed = 0;
  while (elapsed < durationMs && presentationCurrent(run)) {
    if (!await waitPresentation(50, run)) return;
    if (presentationPaused) continue;
    elapsed += 50;
    const completed = Math.min(totalLines, Math.floor(totalLines * elapsed / durationMs));
    renderMachineSimulationProgress(completed, totalLines, "running");
  }
  if (presentationCurrent(run)) renderMachineSimulationProgress(totalLines, totalLines, "complete");
}

function presentationFieldName(target) {
  const label = target.closest("label");
  if (label) return label.childNodes[0]?.textContent.trim() || target.id;
  return target.textContent.trim() || target.id;
}

function setPresentationSubstepText(text) {
  const line = byId("presentation-substep");
  line.textContent = text;
  line.hidden = !text;
}

function setPresentationSubstep(item, target) {
  const text = item.kind === "simulate"
    ? i18n.t("ui.presentation.substeps.simulate")
    : i18n.t(`ui.presentation.substeps.${item.kind}`, { field: presentationFieldName(target) });
  setPresentationSubstepText(text);
}

async function typePresentationValue(input, value, run) {
  input.focus({ preventScroll: true });
  input.value = "";
  for (const character of String(value)) {
    input.value += character;
    if (!await waitPresentation(110, run)) return false;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return presentationCurrent(run);
}

async function simulatePresentationJob(run) {
  const simulationDocument = createPresentationSimulationDocument(readDocument());
  const plan = planGrblJob(simulationDocument, { maxSpindleSpeed: SIMULATOR_MAX_SPINDLE_SPEED });
  showMachineSimulation(plan, simulationDocument, createMachinePlayback(plan).totalLines);
  movePresentationUi(byId("machine-preview-dialog"));
  await animatePresentationSimulation(run);
  return presentationCurrent(run);
}

async function performPresentationSubstep(item, target, run) {
  if (item.kind === "type") return typePresentationValue(target, item.value, run);
  if (item.kind === "choose") {
    setPresentationInput(target, item.value);
    return presentationCurrent(run);
  }
  if (item.kind === "click") {
    target.click();
    if (target.id === "preview-machine-job") movePresentationUi(byId("machine-preview-dialog"));
    return presentationCurrent(run);
  }
  if (item.kind === "simulate") return simulatePresentationJob(run);
  throw new RangeError(`Ação de apresentação desconhecida: ${item.kind}`);
}

async function runPresentation(run) {
  const { card } = presentationUi();
  card.hidden = false;
  byId("presentation-toggle").hidden = false;
  byId("presentation-restart").hidden = true;
  for (const [index, step] of PRESENTATION_STEPS.entries()) {
    const title = i18n.t(`ui.presentation.steps.${step.key}.title`);
    const description = i18n.t(`ui.presentation.steps.${step.key}.description`);
    setPresentationStep(index + 1, title, description);
    try {
      for (const item of step.substeps) {
        const target = document.querySelector(item.target);
        if (!target) throw new RangeError(`O alvo da apresentação não existe: ${item.target}`);
        setPresentationSubstep(item, target);
        if (!await movePresentationCursor(target, run)) return;
        if (!await performPresentationSubstep(item, target, run)) return;
      }
    } catch (error) {
      showNotice(i18n.t("ui.presentation.failure", { error: formatError(error) }));
      finishPresentation();
      return;
    }
    if (!presentationCurrent(run)) return;
    if (index < PRESENTATION_STEPS.length - 1 && !await waitPresentation(500, run)) return;
  }
  if (!presentationCurrent(run)) return;
  setPresentationStep(
    PRESENTATION_STEPS.length,
    i18n.t("ui.presentation.completeTitle"),
    i18n.t("ui.presentation.completeDescription")
  );
  byId("presentation-step-label").textContent = i18n.t("ui.presentation.completeLabel");
  byId("presentation-toggle").hidden = true;
  byId("presentation-restart").hidden = false;
}

function beginPresentation() {
  if (machineBusy) {
    showNotice(i18n.t("ui.presentation.busy"));
    return;
  }
  if (presentationActive) return;
  presentationSnapshot = savePresentationState();
  presentationActive = true;
  presentationPaused = false;
  presentationRun += 1;
  const run = presentationRun;
  document.body.classList.add("presentation-active");
  document.documentElement.classList.add("presentation-active");
  resetPresentationDemo();
  setPresentationPauseLabel(false);
  void runPresentation(run);
}

function restartPresentation() {
  if (!presentationActive) return;
  presentationRun += 1;
  const run = presentationRun;
  presentationPaused = false;
  resetPresentationDemo();
  setPresentationPauseLabel(false);
  void runPresentation(run);
}

function setPresentationPauseLabel(paused) {
  presentationPaused = paused;
  const button = byId("presentation-toggle");
  button.textContent = i18n.t(paused ? "ui.presentation.resume" : "ui.presentation.pause");
  button.setAttribute("aria-pressed", String(!paused));
}

function togglePresentationPlayback() {
  setPresentationPauseLabel(!presentationPaused);
}

async function exportGcode() {
  await prepareRasters();
  const plan = createMachinePlan();
  downloadFile(plan.gcode, "commburn-trabalho.gcode", "text/plain;charset=utf-8");
  showNotice("G-code GRBL exportado. Confira a origem e os limites da máquina antes de executar.");
}

async function importSvgFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".svg")) throw new Error("Escolha um arquivo com extensão .svg.");
  if (file.size > 10 * 1024 * 1024) throw new RangeError("O SVG deve ter no máximo 10 MB.");
  const layer = currentDocument.layers.find((candidate) => candidate.id === activeLayerId);
  if (!layer || layer.locked) throw new Error("Selecione uma camada desbloqueada para importar objetos.");
  if (!globalThis.svgson?.parseSync) throw new Error("O parser SVG local não foi carregado.");

  const source = await file.text();
  const sanitizedSource = validateSvgSource(source);
  const tree = globalThis.svgson.parseSync(sanitizedSource);
  byId("svg-import-file-name").textContent = file.name;
  const dialog = byId("svg-import-dialog");
  const mode = await new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "import" ? byId("svg-import-mode").value : null);
    }, { once: true });
    dialog.showModal();
  });
  if (!mode) return;

  const importOptions = {
    layerId: activeLayerId,
    fallbackLayer: layer,
    idPrefix: nextImportIdPrefix(currentDocument.elements.map((element) => element.id), nextId)
  };
  if (mode === "editable") {
    importOptions.forceLayerId = activeLayerId;
  }
  importOptions.splitShapes = byId("svg-import-split").checked;
  const imported = fitImportedToTable(importSvgTree(tree, importOptions), currentDocument.widthMm, currentDocument.heightMm);
  // Raster images never share a layer with vectors, so SVG images get their own layer.
  const imageLayer = imported.elements.some((element) => element.type === "image") ? createLayerRecord() : null;
  const importedElements = imageLayer ? moveImagesToLayer(imported.elements, imageLayer.id) : imported.elements;
  const elements = [...currentDocument.elements, ...importedElements];
  currentDocument = createDocument({
    ...currentDocument,
    layers: [...currentDocument.layers, ...imported.layers.filter((candidate) => candidate.id !== activeLayerId), ...(imageLayer ? [imageLayer] : [])],
    elements
  });
  widthInput.value = currentDocument.widthMm;
  heightInput.value = currentDocument.heightMm;
  nextId += imported.elements.length;
  selectedIds = [imported.elements.at(-1).id];
  selectedId = selectedIds[0];
  syncInspector();
  renderPreview();
  commitHistory();
  const imageNotice = imageLayer ? ` ${i18n.t("ui.dialogs.svgImagesNewLayer")}` : "";
  const styleCount = imported.ignoredStyles.reduce((total, entry) => total + entry.count, 0);
  const importNotice = imported.scale < 1
    ? `SVG importado: ${imported.elements.length} objeto(s), reduzido a ${(imported.scale * 100).toFixed(1)}% para caber na mesa. A área de trabalho foi mantida.`
    : `SVG importado: ${imported.elements.length} objeto(s) editável(is), em milímetros.`;
  showNotice(`${styleCount
    ? `${importNotice} ${i18n.t("ui.import.styleIgnored", { count: styleCount })}`
    : importNotice}${imageNotice}`);
}

async function importProjectFile(file) {
  if (file.size === 0 || file.size > 50 * 1024 * 1024) {
    throw new RangeError("O projeto deve ter entre 1 byte e 50 MB.");
  }
  const imported = parseProject(await file.text());
  projectNameInput.value = file.name.replace(/(?:\.commburn)?\.json$/i, "") || i18n.t("app.unsavedProject");
  projectNameIsUserValue = true;
  currentDocument = imported;
  generatedLayerNames.clear();
  activeLayerId = imported.layers[0].id;
  selectedIds = [];
  selectedId = null;
  widthInput.value = imported.widthMm;
  heightInput.value = imported.heightMm;
  setOriginCorner(imported.origin.corner);
  history.reset(imported);
  history.markSaved(null);
  syncInspector();
  renderPreview();
  renderSaveState();
  showNotice("Projeto CommBurn carregado e validado.");
}

function imageBlobFromDataUri(dataUri) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUri);
  if (!match) throw new TypeError("A imagem incorporada tem um formato inválido.");
  const binary = atob(match[2]);
  return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: `image/${match[1]}` });
}

function blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") reject(new Error("Não foi possível codificar a imagem editada."));
      else resolve(reader.result);
    }, { once: true });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Não foi possível codificar a imagem editada.")), { once: true });
    reader.readAsDataURL(blob);
  });
}

function layerAcceptsImages(layer) {
  return currentDocument.elements.every((element) => element.layerId !== layer.id || element.type === "image");
}

function askNewLayerForImage() {
  const dialog = byId("image-layer-dialog");
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "new-layer"), { once: true });
    dialog.showModal();
  });
}

async function openImageEditor(file = null) {
  let target;
  let sourceBlob;
  let layerId;
  if (file) {
    if (file.size === 0 || file.size > 25 * 1024 * 1024) {
      throw new RangeError("A imagem deve ter entre 1 byte e 25 MB.");
    }
    const extension = file.name.toLowerCase().split(".").at(-1);
    const mimeByExtension = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
      bmp: "image/bmp", avif: "image/avif", tif: "image/tiff", tiff: "image/tiff"
    };
    if ((file.type && !file.type.startsWith("image/")) || (!file.type && !mimeByExtension[extension])) {
      throw new TypeError("Escolha um arquivo de imagem compatível com o navegador.");
    }
    let layer = currentDocument.layers.find((candidate) => candidate.id === activeLayerId);
    if (!layer || layer.locked) throw new Error("Selecione uma camada desbloqueada para importar objetos.");
    if (!layerAcceptsImages(layer)) {
      if (!await askNewLayerForImage()) throw new Error(i18n.t("ui.dialogs.imageLayerRejected"));
      addLayer();
      layer = currentDocument.layers.find((candidate) => candidate.id === activeLayerId);
    }
    layerId = layer.id;
    target = { mode: "import", layerId };
    sourceBlob = file.type ? file : new Blob([file], { type: mimeByExtension[extension] });
  } else {
    const source = currentDocument.elements.find((element) => element.id === selectedId);
    if (!source || source.type !== "image") throw new Error("Selecione uma imagem raster para editar.");
    const layer = currentDocument.layers.find((candidate) => candidate.id === source.layerId);
    if (!layer || layer.locked) throw new Error("Desbloqueie a camada da imagem antes de editá-la.");
    target = { mode: "edit", elementId: source.id, layerId: source.layerId };
    sourceBlob = imageBlobFromDataUri(source.imageDataUri);
  }

  pendingImageEdit = target;
  byId("apply-image-edit").disabled = true;
  byId("image-editor-status").textContent = "Carregando imagem no editor…";
  byId("image-edit-dialog").showModal();
  try {
    rasterImageEditor = new RasterImageEditor({
      container: byId("image-editor-container"),
      locale: IMAGE_EDITOR_PT_BR.id,
      locales: [IMAGE_EDITOR_PT_BR],
      maxSourcePixels: 20_000_000,
      previewMaxSize: 1600
    });
    await rasterImageEditor.fromBlob(sourceBlob);
    const dimensions = rasterImageEditor.state.source;
    if (!dimensions || !dimensions.width || !dimensions.height) {
      throw new RangeError("O editor não encontrou dimensões válidas para a imagem.");
    }
    if (dimensions.width * dimensions.height > 20_000_000) {
      throw new RangeError("A imagem excede o limite de 20 milhões de pixels.");
    }

    const existing = target.mode === "edit"
      ? currentDocument.elements.find((element) => element.id === target.elementId)
      : null;
    if (existing) {
      byId("image-import-width").value = existing.widthMm;
      byId("image-import-height").value = existing.heightMm;
    } else {
      const mmPerPixel = 25.4 / 96;
      const fit = Math.min(1,
        currentDocument.widthMm / (dimensions.width * mmPerPixel),
        currentDocument.heightMm / (dimensions.height * mmPerPixel));
      byId("image-import-width").value = Math.max(0.1, Number((dimensions.width * mmPerPixel * fit).toFixed(2)));
      byId("image-import-height").value = Math.max(0.1, Number((dimensions.height * mmPerPixel * fit).toFixed(2)));
    }
    byId("image-editor-status").textContent =
      `${dimensions.width} × ${dimensions.height} px · ajuste o tamanho final do objeto em milímetros.`;
    byId("apply-image-edit").disabled = false;
  } catch (error) {
    byId("image-edit-dialog").close();
    throw error;
  }
}

async function applyImageEdit() {
  if (!rasterImageEditor || !pendingImageEdit) throw new Error("Abra uma imagem no editor antes de aplicar.");
  const widthInputMm = byId("image-import-width");
  const heightInputMm = byId("image-import-height");
  const widthMm = numberFrom(widthInputMm, "Largura", Number.MIN_VALUE);
  const heightMm = numberFrom(heightInputMm, "Altura", Number.MIN_VALUE);
  byId("apply-image-edit").disabled = true;
  try {
    const imageBlob = await rasterImageEditor.toBlob({ type: "image/png" });
    if (imageBlob.size > 25 * 1024 * 1024) {
      throw new RangeError("A imagem editada excede 25 MB; reduza suas dimensões no editor.");
    }
    const bitmap = await createImageBitmap(imageBlob);
    const pixelWidth = bitmap.width;
    const pixelHeight = bitmap.height;
    bitmap.close();
    if (!pixelWidth || !pixelHeight || pixelWidth * pixelHeight > 20_000_000) {
      throw new RangeError("A imagem editada precisa ter dimensões válidas e no máximo 20 milhões de pixels.");
    }
    const imageDataUri = await blobToDataUri(imageBlob);
    const layer = currentDocument.layers.find((candidate) => candidate.id === pendingImageEdit.layerId);
    if (!layer || layer.locked) throw new Error("Desbloqueie a camada de destino antes de aplicar a imagem.");
    if (pendingImageEdit.mode === "edit") {
      const source = currentDocument.elements.find((element) => element.id === pendingImageEdit.elementId);
      if (!source || source.type !== "image") throw new Error("A imagem selecionada não está mais no documento.");
      currentDocument = createDocument({
        ...readDocument(),
        elements: currentDocument.elements.map((element) => element.id === source.id
          ? { ...element, imageDataUri, widthMm, heightMm }
          : element)
      });
      selectedIds = [source.id];
      selectedId = source.id;
    } else {
      const element = {
        id: `image-${nextId++}`,
        type: "image",
        xMm: 0,
        yMm: 0,
        widthMm,
        heightMm,
        imageDataUri,
        preserveAspectRatio: "xMidYMid meet",
        rotationDeg: 0,
        skewXDeg: 0,
        skewYDeg: 0,
        layerId: layer.id
      };
      currentDocument = createDocument({ ...readDocument(), elements: [...currentDocument.elements, element] });
      selectedIds = [element.id];
      selectedId = element.id;
    }
    const editMode = pendingImageEdit.mode;
    activeLayerId = layer.id;
    syncInspector();
    renderPreview();
    commitHistory();
    byId("image-edit-dialog").close();
    showNotice(editMode === "edit"
      ? "Imagem editada e atualizada no documento."
      : "Imagem editada, incorporada e dimensionada em milímetros.");
  } finally {
    if (rasterImageEditor) byId("apply-image-edit").disabled = false;
  }
}

function imageConversionOptions(element) {
  const readNumber = (id, label) => {
    return numberFrom(byId(id), label);
  };
  return {
    xMm: element.xMm,
    yMm: element.yMm,
    widthMm: element.widthMm,
    heightMm: element.heightMm,
    idPrefix: `vector-${crypto.randomUUID()}`,
    traceOptions: {
      numberofcolors: readNumber("image-vector-colors", "Quantidade de cores"),
      pathomit: readNumber("image-vector-pathomit", "Remoção de detalhes"),
      ltres: readNumber("image-vector-line-tolerance", "Suavização de linhas"),
      qtres: readNumber("image-vector-curve-tolerance", "Ajuste de curvas"),
      colorsampling: 2,
      colorquantcycles: 3,
      layering: 0,
      rightangleenhance: true,
      scale: 1,
      roundcoords: 1,
      viewbox: true
    }
  };
}

function imageVectorStyleOptions() {
  const strokeColorMode = byId("image-vector-border-mode").value;
  const strokeInput = byId("image-vector-border-width");
  const strokeWidthMm = strokeColorMode === "none" ? 0 : numberFrom(strokeInput, "Espessura da borda");
  return { fillColorMode: "layer", strokeColorMode, strokeWidthMm };
}

function syncImageVectorStyleControls() {
  byId("image-vector-border-width").disabled = byId("image-vector-border-mode").value === "none";
}

function cancelImageTracePreview() {
  imageTraceCancellation?.();
}

function traceImageData(imageData, width, height, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./ui/image-trace-worker.js", import.meta.url));
    let settled = false;
    const finish = (error, svg) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      if (imageTraceCancellation === cancel) imageTraceCancellation = null;
      if (error) reject(error);
      else resolve(svg);
    };
    const cancel = () => finish(new Error("A prévia de vetorização foi cancelada."));
    imageTraceCancellation = cancel;
    worker.addEventListener("message", ({ data }) => {
      if (data.error) finish(new Error(data.error));
      else if (typeof data.svg !== "string") finish(new Error("O vetorizador não retornou um SVG."));
      else finish(null, data.svg);
    }, { once: true });
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      finish(new Error(event.message || "Falha ao executar o vetorizador local."));
    }, { once: true });
    try {
      const pixels = imageData.data.slice();
      worker.postMessage({ pixels: pixels.buffer, width, height, options }, [pixels.buffer]);
    } catch (error) {
      finish(error);
    }
  });
}

async function vectorizeImageElement(element) {
  if (element.rotationDeg !== 0 || element.skewXDeg !== 0 || element.skewYDeg !== 0) {
    throw new RangeError("Redefina rotação e distorção antes de converter o objeto visual.");
  }
  let drawable;
  let drawableWidth;
  let drawableHeight;
  let releaseDrawable = () => {};
  if (element.type === "image") {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(element.imageDataUri);
    if (!match) throw new TypeError("A imagem incorporada tem um formato inválido.");
    const binary = atob(match[2]);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    drawable = await createImageBitmap(new Blob([bytes], { type: `image/${match[1]}` }));
    drawableWidth = drawable.width;
    drawableHeight = drawable.height;
    releaseDrawable = () => drawable.close();
  } else {
    throw new TypeError("Selecione uma imagem raster para converter em vetores.");
  }
  if (drawableWidth * drawableHeight > 20_000_000) {
    releaseDrawable();
    throw new RangeError("O objeto visual excede o limite de 20 milhões de pixels para conversão.");
  }
  const options = imageConversionOptions(element);
  const maximumSamples = 2_000_000;
  const sampleScale = Math.min(1, Math.sqrt(maximumSamples / (drawableWidth * drawableHeight)));
  const pixelWidth = Math.max(1, Math.min(drawableWidth, maximumSamples, Math.floor(drawableWidth * sampleScale)));
  const pixelHeight = Math.max(1, Math.min(
    drawableHeight,
    Math.floor(drawableHeight * sampleScale),
    Math.floor(maximumSamples / pixelWidth)
  ));
  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    releaseDrawable();
    throw new Error("O navegador não disponibilizou o canvas necessário para processar a imagem.");
  }
  try {
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pixelWidth, pixelHeight);
    context.drawImage(drawable, 0, 0, pixelWidth, pixelHeight);
  } finally {
    releaseDrawable();
  }
  const pixels = context.getImageData(0, 0, pixelWidth, pixelHeight);
  const traceSvg = await traceImageData(pixels, pixelWidth, pixelHeight, options.traceOptions);
  if (!globalThis.svgson?.parseSync) {
    throw new Error("O parser SVG local não foi carregado para converter as regiões.");
  }
  const tree = globalThis.svgson.parseSync(validateSvgSource(traceSvg));
  const sourceLayer = currentDocument.layers.find((layer) => layer.id === element.layerId);
  const imported = importTracedImageSvg(tree, {
    xMm: options.xMm,
    yMm: options.yMm,
    widthMm: element.widthMm,
    heightMm: element.heightMm,
    sourceLayer,
    idPrefix: `vector-${crypto.randomUUID()}`
  });
  return {
    elements: imported.elements,
    preview: { width: pixelWidth, height: pixelHeight },
    stats: { ...imported.stats, pixelWidth, pixelHeight }
  };
}

async function drawTracePreview(preview) {
  const canvas = byId("image-vector-preview");
  canvas.width = preview.width;
  canvas.height = preview.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("O navegador não disponibilizou o canvas de prévia.");
  const previewUrl = URL.createObjectURL(new Blob([preview.svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = previewUrl;
    await image.decode();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, preview.width, preview.height);
    context.drawImage(image, 0, 0, preview.width, preview.height);
  } finally {
    URL.revokeObjectURL(previewUrl);
  }
}

async function drawVectorPreview(
  result,
  source,
  selectedColors = new Set(result.elements.map((element) => element.color)),
  styles = { fillColorMode: "image", strokeColorMode: "none", strokeWidthMm: 0 }
) {
  const sourceLayer = currentDocument.layers.find((layer) => layer.id === source.layerId);
  const previewDocument = createDocument({
    widthMm: source.widthMm,
    heightMm: source.heightMm,
    layers: [sourceLayer],
    elements: result.elements.filter((element) => selectedColors.has(element.color)).map((element) => ({
      ...element,
      ...styles,
      xMm: element.xMm - source.xMm,
      yMm: element.yMm - source.yMm
    }))
  });
  const parsedSvg = new DOMParser().parseFromString(renderSvg(previewDocument), "image/svg+xml");
  if (parsedSvg.querySelector("parsererror")) throw new Error("Não foi possível renderizar os vetores da prévia.");
  const svg = parsedSvg.documentElement;
  svg.setAttribute("width", `${result.preview.width}px`);
  svg.setAttribute("height", `${result.preview.height}px`);
  svg.setAttribute("viewBox", `0 0 ${source.widthMm} ${source.heightMm}`);
  svg.setAttribute("preserveAspectRatio", "none");
  await drawTracePreview({
    svg: new XMLSerializer().serializeToString(svg),
    width: result.preview.width,
    height: result.preview.height
  });
}

function updateImageVectorStyleControls() {
  try {
    syncImageVectorStyleControls();
    if (imageVectorResult) updateImageVectorStats(imageVectorResult);
    imageVectorStyleOptions();
  } catch (error) {
    byId("image-vector-stats").textContent = error instanceof FieldValidationError
      ? ""
      : i18n.t("ui.dialogs.vectorInvalidConfiguration", { error: formatError(error) });
    byId("apply-image-vector").disabled = true;
  }
}

function updateImageVectorStats(result) {
  const selectedElements = result.elements.filter((element) => imageVectorColors.has(element.color));
  const selectedColors = new Set(selectedElements.map((element) => element.color));
  byId("image-vector-stats").textContent = i18n.t("ui.dialogs.vectorStats", {
    regions: selectedElements.length,
    colors: selectedColors.size,
    width: result.stats.pixelWidth,
    height: result.stats.pixelHeight
  });
  byId("apply-image-vector").disabled = selectedElements.length === 0;
}

function showImageVectorColors(result, source) {
  const colorCounts = new Map();
  for (const element of result.elements) colorCounts.set(element.color, (colorCounts.get(element.color) ?? 0) + 1);
  imageVectorColors = new Set(colorCounts.keys());
  const options = byId("image-vector-color-options");
  options.replaceChildren(...Array.from(colorCounts, ([color, count]) => {
    const label = document.createElement("label");
    label.className = "image-vector-color-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.setAttribute("aria-label", i18n.t("ui.dialogs.vectorColorOption", { color, count }));
    const swatch = document.createElement("span");
    swatch.className = "image-vector-color-swatch";
    swatch.style.setProperty("--swatch-color", color);
    const caption = document.createElement("span");
    caption.textContent = `${color} · ${count}`;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) imageVectorColors.add(color);
      else imageVectorColors.delete(color);
      updateImageVectorStats(result);
      void drawVectorPreview(result, source, imageVectorColors).catch((error) => {
        byId("image-vector-stats").textContent = i18n.t("ui.dialogs.vectorPreviewUnavailable", { error: formatError(error) });
        byId("apply-image-vector").disabled = true;
      });
    });
    label.append(checkbox, swatch, caption);
    return label;
  }));
  updateImageVectorStats(result);
}

async function updateImageVectorPreview() {
  const sequence = ++imageVectorPreviewSequence;
  cancelImageTracePreview();
  imageVectorResult = null;
  byId("apply-image-vector").disabled = true;
  byId("image-vector-color-options").replaceChildren();
  byId("image-vector-stats").textContent = i18n.t("ui.dialogs.preparingVectorPreview");
  const source = currentDocument.elements.find((element) => element.id === imageVectorSourceId);
  if (!source || source.type !== "image") return;
  try {
    const result = await vectorizeImageElement(source);
    if (sequence !== imageVectorPreviewSequence) return;
    imageVectorResult = result;
    showImageVectorColors(result, source);
    await drawVectorPreview(result, source, imageVectorColors);
    if (sequence !== imageVectorPreviewSequence) return;
  } catch (error) {
    if (sequence !== imageVectorPreviewSequence) return;
    byId("image-vector-stats").textContent = error instanceof FieldValidationError
      ? ""
      : i18n.t("ui.dialogs.vectorConversionUnavailable", { error: formatError(error) });
  }
}

function syncImageVectorTargetOptions(sourceId) {
  const select = byId("image-vector-target");
  select.replaceChildren(new Option(i18n.t("ui.dialogs.newLayer"), "new"),
    ...vectorTargetLayers(currentDocument.layers, currentDocument.elements, sourceId).map((layer) => new Option(layer.name, layer.id)));
  select.value = "new";
}

function openImageVectorizer() {
  try {
    const source = currentDocument.elements.find((element) => element.id === selectedId);
    if (!source || source.type !== "image") {
      throw new Error("Selecione uma imagem raster para converter em vetores.");
    }
    const layer = currentDocument.layers.find((candidate) => candidate.id === source.layerId);
    if (!layer || layer.locked) throw new Error("Desbloqueie a camada da imagem antes de convertê-la.");
    imageVectorSourceId = source.id;
    syncImageVectorTargetOptions(source.id);
    syncImageVectorStyleControls();
    byId("image-vector-dialog").showModal();
    void updateImageVectorPreview();
  } catch (error) {
    showNotice(error);
  }
}

function applyImageVectorization() {
  try {
    const source = currentDocument.elements.find((element) => element.id === imageVectorSourceId);
    if (!source || source.type !== "image" || !imageVectorResult) {
      throw new Error("Gere uma prévia vetorial válida para uma imagem raster antes de aplicar.");
    }
    const targetValue = byId("image-vector-target").value;
    const newLayer = targetValue === "new" ? createLayerRecord() : null;
    const targetLayerId = newLayer?.id ?? targetValue;
    if (!newLayer && !vectorTargetLayers(currentDocument.layers, currentDocument.elements, source.id).some((layer) => layer.id === targetLayerId)) {
      throw new Error(i18n.t("ui.dialogs.targetLayerUnavailable"));
    }
    const styles = imageVectorStyleOptions();
    const convertedElements = imageVectorResult.elements
      .filter((element) => imageVectorColors.has(element.color))
      .map((element) => ({ ...element, ...styles, layerId: targetLayerId }));
    if (!convertedElements.length) throw new Error("Selecione ao menos uma cor para converter.");
    const convertedIds = convertedElements.map((element) => element.id);
    const snapshot = readDocument();
    currentDocument = createDocument({
      ...snapshot,
      layers: newLayer ? [...currentDocument.layers, newLayer] : currentDocument.layers,
      elements: [
        ...currentDocument.elements.filter((element) => element.id !== source.id),
        ...convertedElements
      ]
    });
    selectedIds = convertedIds.length ? [convertedIds.at(-1)] : [];
    selectedId = convertedIds.at(-1) ?? null;
    activeLayerId = targetLayerId;
    syncInspector();
    renderPreview();
    commitHistory();
    byId("image-vector-dialog").close();
    showNotice(`${convertedIds.length} região(ões) vetorial(is) sólida(s) criada(s) em ${new Set(convertedElements.map((element) => element.color)).size} cor(es).`);
  } catch (error) {
    showNotice(error);
  }
}

function openPathEditor() {
  const selected = currentDocument.elements.find((element) => element.id === selectedId);
  if (!selected || selected.type !== "path") {
    showNotice("Selecione um traçado vetorial editável.");
    return;
  }
  try {
    pathEditor.open(selected.pathData, selected.widthMm, selected.heightMm, (pathData, widthMm, heightMm) => {
      try {
        const elements = currentDocument.elements.map((element) =>
          element.id === selected.id ? { ...element, pathData, widthMm, heightMm } : element
        );
        currentDocument = createDocument({ ...currentDocument, elements });
        syncInspector();
        renderPreview();
        commitHistory();
      } catch (error) {
        showNotice(error);
        return false;
      }
    });
  } catch (error) {
    showNotice(error);
  }
}

function newDocument() {
  projectNameInput.value = i18n.t("app.unsavedProject");
  projectNameIsUserValue = false;
  currentDocument = createDocument({ widthMm: 180, heightMm: 120 });
    generatedLayerNames.clear();
    generatedLayerNames.set(currentDocument.layers[0].id, { kind: "engraving" });
  activeLayerId = currentDocument.layers[0].id;
  widthInput.value = "180";
  heightInput.value = "120";
  setOriginCorner("top-left");
  selectedId = null;
  selectedIds = [];
  textInput.value = "";
  currentDocument = readDocument();
  syncInspector();
  renderPreview();
  history.markUnsaved();
  commitHistory();
  showNotice("Novo trabalho criado.");
}

function renderDocumentFields(commit = false) {
  for (const input of [widthInput, heightInput]) {
    const result = validateNumberField(input);
    if (!result.valid) {
      showNumberFieldError(input, result, i18n.t);
      input.focus({ preventScroll: true });
      return;
    }
    clearNumberFieldError(input);
  }
  renderPreview();
  if (commit) commitHistory();
}

for (const input of [widthInput, heightInput]) {
  input.addEventListener("input", () => renderDocumentFields());
  input.addEventListener("change", () => renderDocumentFields(true));
}
originInput.addEventListener("change", () => {
  renderPreview();
  commitHistory();
});

// "set" shows the primary selection's value; "relative" starts each delta at 0.
function syncQuickProperties() {
  const panel = byId("quick-properties");
  const primary = currentDocument.elements.find((element) => element.id === selectedId);
  panel.hidden = selectedIds.length === 0 || !primary;
  if (panel.hidden) return;
  const locked = currentDocument.layers.find((layer) => layer.id === primary.layerId)?.locked ?? false;
  for (const input of panel.querySelectorAll("[data-quick-property]")) {
    const property = input.dataset.quickProperty;
    const mode = panel.querySelector(`[data-quick-mode="${property}"]`).value;
    input.value = mode === "set" ? primary[property] ?? "" : 0;
    input.disabled = locked;
    panel.querySelector(`[data-quick-mode="${property}"]`).disabled = locked;
  }
}

function applyQuickProperty(input) {
  const panel = byId("quick-properties");
  const property = input.dataset.quickProperty;
  const mode = panel.querySelector(`[data-quick-mode="${property}"]`).value;
  const minimum = mode === "set" ? ADJUSTABLE_PROPERTIES[property].minimum : -Infinity;
  const value = numberFrom(input, property, minimum);
  updateMany(computeAdjustedUpdates(currentDocument.elements, selectedIds, { property, mode, value }));
  syncQuickProperties();
}

for (const input of byId("quick-properties").querySelectorAll("[data-quick-property]")) {
  input.addEventListener("change", () => {
    try {
      applyQuickProperty(input);
    } catch (error) {
      showNotice(error);
    }
  });
}

for (const select of byId("quick-properties").querySelectorAll("[data-quick-mode]")) {
  select.addEventListener("change", () => syncQuickProperties());
}

function updateSelectedFromInput(input) {
  const numericProperties = {
    "object-x": ["xMm", -Infinity],
    "object-y": ["yMm", -Infinity],
    "object-width": ["widthMm", 0],
    "object-height": ["heightMm", 0],
    "object-rotation": ["rotationDeg", -Infinity],
    "object-skew-x": ["skewXDeg", -79],
    "object-skew-y": ["skewYDeg", -79]
  };
  if (numericProperties[input.id]) {
    const [property, minimum] = numericProperties[input.id];
    const value = numberFrom(input, property, minimum);
    const patch = { [property]: value };
    const current = currentDocument.elements.find((element) => element.id === selectedId);
    const other = property === "widthMm" ? "heightMm" : "widthMm";
    if (byId("object-lock-ratio").checked && current && ["widthMm", "heightMm"].includes(property)
      && current.widthMm > 0 && current.heightMm > 0 && value > 0) {
      patch[other] = current[other] * value / current[property];
    }
    updateSelected(patch);
  } else if (input.id === "object-text") {
    updateSelected({ text: input.value }, true, false);
  } else if (input.id === "object-font") {
    updateSelected({ fontFamily: normalizeFontFamily(input.value) });
  } else if (input.id === "object-font-bold" || input.id === "object-font-italic") {
    updateSelected(input.id === "object-font-bold"
      ? { fontWeight: input.checked ? "bold" : "normal" }
      : { fontStyle: input.checked ? "italic" : "normal" });
  }
}

for (const input of byId("object-inspector").querySelectorAll("input, textarea, select")) {
  input.addEventListener(input.matches("textarea") && input.id === "object-text" ? "input" : "change", () => {
    try {
      updateSelectedFromInput(input);
    } catch (error) {
      showNotice(error);
    }
  });
}

byId("new-shape-type").addEventListener("change", () => {
  const lineSelected = byId("new-shape-type").value === "line";
  byId("new-shape-width").min = lineSelected ? "0" : "0.1";
  byId("new-shape-height").min = lineSelected ? "0" : "0.1";
  byId("shape-help").textContent = lineSelected
    ? "A linha pode ter altura ou largura zero, mas não ambas."
    : "Largura e altura devem ser maiores que zero.";
});

byId("orientation").addEventListener("click", () => {
  [widthInput.value, heightInput.value] = [heightInput.value, widthInput.value];
  renderPreview();
  commitHistory();
});
byId("add-text").addEventListener("click", () => {
  try { addText(); } catch (error) { showNotice(error); }
});
byId("add-shape").addEventListener("click", () => {
  try { addShape(); } catch (error) { showNotice(error); }
});
removeButton.addEventListener("click", removeSelectedObject);
byId("duplicate-selection").addEventListener("click", duplicateSelectedObject);

function revealInspector() {
  const inspector = byId("object-inspector");
  if (inspector.hidden) return;
  inspector.scrollIntoView({ behavior: "smooth", block: "start" });
}

const objectContextMenu = byId("object-context-menu");

function hideObjectContextMenu() {
  objectContextMenu.hidden = true;
}

function showObjectContextMenu({ id, clientX, clientY }) {
  if (!selectedIds.includes(id)) selectObjectWithOptions(id);
  renderContextLayerMenu();
  objectContextMenu.hidden = false;
  const { width, height } = objectContextMenu.getBoundingClientRect();
  objectContextMenu.style.left = `${Math.max(0, Math.min(clientX, window.innerWidth - width - 8))}px`;
  objectContextMenu.style.top = `${Math.max(0, Math.min(clientY, window.innerHeight - height - 8))}px`;
  objectContextMenu.querySelector("button")?.focus();
}

function renderContextLayerMenu() {
  byId("context-layer-list").replaceChildren(...currentDocument.layers.map((layer, index) => {
    const item = document.createElement("button");
    item.className = "context-menu-item";
    item.type = "button";
    item.role = "menuitem";
    item.dataset.contextLayer = layer.id;
    item.disabled = layer.locked;
    const swatch = document.createElement("span");
    swatch.className = "context-swatch";
    swatch.style.backgroundColor = layer.color;
    item.append(swatch, getLayerDisplayName(layer, index));
    return item;
  }));
}

function moveSelectionToLayer(layerId) {
  const target = currentDocument.layers.find((layer) => layer.id === layerId);
  if (!target || target.locked) return;
  const movableIds = new Set(selectedIds.filter((id) => {
    const element = currentDocument.elements.find((candidate) => candidate.id === id);
    return element && !currentDocument.layers.find((layer) => layer.id === element.layerId)?.locked;
  }));
  if (movableIds.size === 0) return;
  try {
    currentDocument = createDocument({
      ...currentDocument,
      elements: currentDocument.elements.map((element) => movableIds.has(element.id) ? { ...element, layerId } : element)
    });
    activeLayerId = layerId;
    syncInspector();
    renderPreview();
    commitHistory();
  } catch (error) {
    showNotice(error);
  }
}

objectContextMenu.addEventListener("click", (event) => {
  if (event.target.closest(".context-submenu > .context-menu-item")) return;
  const layerId = event.target.closest("[data-context-layer]")?.dataset.contextLayer;
  if (layerId) {
    hideObjectContextMenu();
    moveSelectionToLayer(layerId);
    return;
  }
  const action = event.target.closest("[data-context-action]")?.dataset.contextAction;
  hideObjectContextMenu();
  if (action === "properties") revealInspector();
  if (action === "duplicate") duplicateSelectedObject();
  if (action === "copy") copySelectedObjects();
  if (action === "remove") removeSelectedObject();
});
byId("copy-notice").addEventListener("click", async () => {
  if (!noticeLog.value) return;
  try {
    await navigator.clipboard.writeText(noticeLog.value);
  } catch {
    noticeLog.select();
    document.execCommand("copy");
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!objectContextMenu.hidden && !objectContextMenu.contains(event.target)) hideObjectContextMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideObjectContextMenu();
});

function removeSelectedObject() {
  if (selectedIds.length === 0) return;
  const selected = currentDocument.elements.filter((element) => selectedIds.includes(element.id));
  if (selected.some((element) => currentDocument.layers.find((layer) => layer.id === element.layerId)?.locked)) {
    showNotice("Desbloqueie todas as camadas selecionadas antes de remover objetos.");
    return;
  }
  currentDocument = createDocument({
    ...currentDocument,
    elements: currentDocument.elements.filter((element) => !selectedIds.includes(element.id))
  });
  selectedIds = [];
  selectedId = null;
  syncInspector();
  renderPreview();
  commitHistory();
}

function copySelectedObjects() {
  const selected = currentDocument.elements.filter((element) => selectedIds.includes(element.id));
  if (selected.length === 0) {
    showNotice("Selecione ao menos um objeto para copiar.");
    return;
  }
  copiedElements = selected.map((element) => ({ ...element }));
  pasteSequence = 0;
  showNotice(`${copiedElements.length} objeto(s) copiado(s). Selecione a camada de destino e use Ctrl+V.`);
}

function pasteCopiedObjects() {
  try {
    if (copiedElements.length === 0) {
      showNotice("Nenhum objeto copiado. Selecione objetos e use Ctrl+C primeiro.");
      return;
    }
    const targetLayer = currentDocument.layers.find((layer) => layer.id === activeLayerId);
    if (!targetLayer || targetLayer.locked) {
      throw new Error("Selecione uma camada de destino desbloqueada antes de colar.");
    }
    pasteSequence += 1;
    const offsetMm = pasteSequence * 5;
    const pasted = copiedElements.map((element) => ({
      ...element,
      id: `${element.type}-${crypto.randomUUID()}`,
      xMm: element.xMm + offsetMm,
      yMm: element.yMm + offsetMm,
      layerId: targetLayer.id
    }));
    currentDocument = createDocument({
      ...readDocument(),
      elements: [...currentDocument.elements, ...pasted]
    });
    selectedIds = pasted.map((element) => element.id);
    selectedId = selectedIds.at(-1);
    syncInspector();
    renderPreview();
    commitHistory();
    showNotice(`${pasted.length} objeto(s) colado(s) na camada "${targetLayer.name}".`);
  } catch (error) {
    showNotice(error);
  }
}

function duplicateSelectedObject() {
  try {
    const baseDocument = readDocument();
    const selected = baseDocument.elements.filter((element) => selectedIds.includes(element.id));
    if (selected.length === 0) return;
    if (selected.some((element) => baseDocument.layers.find((layer) => layer.id === element.layerId)?.locked)) {
      throw new Error("Desbloqueie todas as camadas selecionadas antes de duplicar objetos.");
    }
    const duplicates = selected.map((element) => ({
      ...element,
      id: `${element.type}-${nextId++}`,
      xMm: element.xMm + 5,
      yMm: element.yMm + 5
    }));
    currentDocument = createDocument({ ...baseDocument, elements: [...baseDocument.elements, ...duplicates] });
    selectedIds = duplicates.map((element) => element.id);
    selectedId = selectedIds.at(-1);
    syncInspector();
    renderPreview();
    commitHistory();
  } catch (error) {
    showNotice(error);
  }
}

function duplicateLayer(layerId) {
  try {
    const source = currentDocument.layers.find((layer) => layer.id === layerId);
    if (!source) throw new RangeError("A camada a duplicar não foi encontrada.");
    const sourceIndex = currentDocument.layers.findIndex((layer) => layer.id === source.id);
    const baseName = i18n.t("ui.layers.copyName", { name: getLayerDisplayName(source, sourceIndex) });
    let name = baseName;
    let suffix = 2;
    while (currentDocument.layers.some((layer) => layer.name === name)) {
      name = `${baseName} ${suffix++}`;
    }
    const duplicate = {
      ...source,
      id: `layer-${crypto.randomUUID()}`,
      name,
      locked: false
    };
    const sourceElements = currentDocument.elements.filter((element) => element.layerId === source.id);
    const duplicatedElements = sourceElements.map((element) => ({
      ...element,
      id: `${element.type}-${crypto.randomUUID()}`,
      layerId: duplicate.id
    }));
    const layerIndex = currentDocument.layers.findIndex((layer) => layer.id === source.id);
    const layers = [...currentDocument.layers];
    layers.splice(layerIndex + 1, 0, duplicate);
    currentDocument = createDocument({
      ...readDocument(),
      layers,
      elements: [...currentDocument.elements, ...duplicatedElements]
    });
    generatedLayerNames.set(duplicate.id, {
      kind: "copy",
      sourceId: source.id,
      sourceName: getLayerDisplayName(source, sourceIndex),
      suffix: name === baseName ? "" : ` ${suffix - 1}`
    });
    activeLayerId = duplicate.id;
    selectedIds = duplicatedElements.map((element) => element.id);
    selectedId = selectedIds.at(-1) ?? null;
    syncInspector();
    renderPreview();
    commitHistory();
    showNotice(i18n.t("ui.layers.duplicateNotice", {
      name: getLayerDisplayName(source, sourceIndex),
      count: duplicatedElements.length
    }));
  } catch (error) {
    showNotice(error);
  }
}

function restoreDocument(snapshot) {
  currentDocument = createDocument(snapshot);
  widthInput.value = currentDocument.widthMm;
  heightInput.value = currentDocument.heightMm;
  setOriginCorner(currentDocument.origin.corner);
  if (!currentDocument.layers.some((layer) => layer.id === activeLayerId)) activeLayerId = currentDocument.layers[0].id;
  selectedIds = selectedIds.filter((id) => currentDocument.elements.some((element) => element.id === id));
  selectedId = selectedIds.at(-1) ?? null;
  syncInspector();
  renderPreview();
  renderSaveState();
}

function captureDocumentTabState() {
  return {
    document: currentDocument,
    history,
    layerNames: [...generatedLayerNames],
    activeLayerId,
    selectedIds: [...selectedIds],
    projectName: projectNameInput.value,
    projectNameIsUserValue
  };
}

function applyDocumentTabState(state) {
  history = state.history;
  generatedLayerNames.clear();
  for (const [id, value] of state.layerNames) generatedLayerNames.set(id, value);
  activeLayerId = state.activeLayerId;
  selectedIds = [...state.selectedIds];
  projectNameInput.value = state.projectName;
  projectNameIsUserValue = state.projectNameIsUserValue;
  restoreDocument(state.document);
  renderLayers();
}

function documentTabsBusy() {
  if (machineBusy || presentationActive) {
    showNotice("Aguarde o trabalho da máquina terminar antes de trocar de aba.");
    return true;
  }
  return false;
}

function switchDocumentTab(id) {
  if (id === activeDocumentTabId || documentTabsBusy()) return;
  const target = documentTabs.find((tab) => tab.id === id);
  documentTabs.find((tab) => tab.id === activeDocumentTabId).state = captureDocumentTabState();
  activeDocumentTabId = id;
  applyDocumentTabState(target.state);
  renderDocumentTabs();
}

function addDocumentTab() {
  if (documentTabsBusy()) return;
  documentTabs.find((tab) => tab.id === activeDocumentTabId).state = captureDocumentTabState();
  documentTabSequence += 1;
  documentTabs.push({ id: `tab-${documentTabSequence}`, state: null });
  activeDocumentTabId = `tab-${documentTabSequence}`;
  history = new DocumentHistory(createDocument({ widthMm: 180, heightMm: 120 }));
  newDocument();
  renderDocumentTabs();
}

function closeDocumentTab(id) {
  if (documentTabs.length === 1 || documentTabsBusy()) return;
  const index = documentTabs.findIndex((tab) => tab.id === id);
  const isActive = id === activeDocumentTabId;
  const state = isActive ? captureDocumentTabState() : documentTabs[index].state;
  if (state.document.elements.length > 0 && !window.confirm(i18n.t("ui.tabs.closeConfirm"))) return;
  documentTabs.splice(index, 1);
  if (isActive) {
    const next = documentTabs[Math.max(0, index - 1)];
    activeDocumentTabId = next.id;
    applyDocumentTabState(next.state);
  }
  renderDocumentTabs();
}

const documentTabsElement = byId("document-tabs");

function renderDocumentTabs() {
  const tabNodes = documentTabs.map((tab) => {
    const isActive = tab.id === activeDocumentTabId;
    const label = isActive ? projectNameInput.value : tab.state.projectName;
    const wrapper = document.createElement("div");
    wrapper.className = `document-tab${isActive ? " is-active" : ""}`;
    const select = document.createElement("button");
    select.type = "button";
    select.className = "document-tab-select";
    select.dataset.tabId = tab.id;
    select.setAttribute("aria-pressed", String(isActive));
    select.textContent = label;
    wrapper.append(select);
    if (documentTabs.length > 1) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "document-tab-close";
      close.dataset.closeTabId = tab.id;
      close.setAttribute("aria-label", i18n.t("ui.tabs.close", { name: label }));
      close.textContent = "×";
      wrapper.append(close);
    }
    return wrapper;
  });
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "document-tab-add";
  addButton.id = "add-document-tab";
  addButton.textContent = i18n.t("ui.tabs.new");
  documentTabsElement.replaceChildren(...tabNodes, addButton);
}

documentTabsElement.addEventListener("click", (event) => {
  const closeId = event.target.closest("[data-close-tab-id]")?.dataset.closeTabId;
  if (closeId) return closeDocumentTab(closeId);
  const selectId = event.target.closest("[data-tab-id]")?.dataset.tabId;
  if (selectId) return switchDocumentTab(selectId);
  if (event.target.closest("#add-document-tab")) addDocumentTab();
});
projectNameInput.addEventListener("input", () => renderDocumentTabs());

function showShortcuts() {
  const list = byId("shortcuts-list");
  list.replaceChildren(...SHORTCUTS.map(({ keys, translationKey, toolId }) => {
    const row = document.createElement("tr");
    const keyCell = document.createElement("td");
    const descriptionCell = document.createElement("td");
    keyCell.textContent = keys;
    const tool = TOOLS.find((candidate) => candidate.id === toolId);
    descriptionCell.textContent = i18n.t(translationKey, { tool: tool ? i18n.t(tool.labelKey) : "" });
    row.append(keyCell, descriptionCell);
    return row;
  }));
  byId("shortcuts-dialog").showModal();
}

function createLayerRecord() {
  const layerIndex = currentDocument.layers.length + 1;
  const layer = {
    id: `layer-${crypto.randomUUID()}`,
    name: i18n.t("ui.layers.defaultName", { index: layerIndex }),
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
    color: ["#3978eb", "#e58a2d", "#32a77f", "#9665d8", "#d65d8c", "#5a718f"][layerIndex % 6]
  };
  generatedLayerNames.set(layer.id, { kind: "numbered" });
  return layer;
}

function addLayer() {
  const layer = createLayerRecord();
  currentDocument = createDocument({ ...currentDocument, layers: [...currentDocument.layers, layer] });
  activeLayerId = layer.id;
  selectedId = null;
  selectedIds = [];
  syncInspector();
  renderPreview();
  commitHistory();
}

function flashActiveLayer() {
  const nodes = [...objects.querySelectorAll(`[data-layer-id="${CSS.escape(activeLayerId)}"]`)];
  for (const node of nodes) node.classList.remove("layer-glow");
  // Forces a reflow so the animation restarts when the same layer is selected again.
  void objects.getBoundingClientRect();
  for (const node of nodes) node.classList.add("layer-glow");
}

const layersPanel = new LayersPanel(byId("layers-list"), {
  t: i18n.t,
  onSelect: (layerId) => {
    activeLayerId = layerId;
    selectedId = null;
    selectedIds = [];
    syncInspector();
    renderPreview();
    flashActiveLayer();
  },
  onAdd: addLayer,
  onUpdate: (layerId, patch) => {
    try {
      currentDocument = createDocument({
        ...currentDocument,
        layers: currentDocument.layers.map((layer) => layer.id === layerId ? { ...layer, ...patch } : layer)
      });
      if (Object.hasOwn(patch, "name")) generatedLayerNames.delete(layerId);
      syncInspector();
      renderPreview();
      commitHistory();
    } catch (error) {
      showNotice(error);
    }
  },
  onDelete: (layerId) => {
    if (currentDocument.layers.length <= 1) return;
    const remainingLayers = currentDocument.layers.filter((layer) => layer.id !== layerId);
    const fallback = remainingLayers[0];
    const elements = currentDocument.elements.map((element) =>
      element.layerId === layerId ? { ...element, layerId: fallback.id } : element
    );
    currentDocument = createDocument({ ...currentDocument, layers: remainingLayers, elements });
    generatedLayerNames.delete(layerId);
    if (activeLayerId === layerId) activeLayerId = fallback.id;
    syncInspector();
    renderPreview();
    commitHistory();
  },
  onDuplicate: duplicateLayer
});

byId("add-layer").addEventListener("click", (event) => {
  if (event.detail > 1) return;
  addLayer();
});
byId("object-layer").addEventListener("change", (event) => {
  const layer = currentDocument.layers.find((candidate) => candidate.id === event.target.value);
  if (!layer || layer.locked) return;
  updateSelected({ layerId: layer.id });
  activeLayerId = layer.id;
  renderLayers();
});

const toolbar = connectToolbar(byId("action-toolbar"), (toolId) => {
  activeTool = toolId;
  if (toolId === "edit") revealInspector();
  const button = byId("action-toolbar").querySelector(`[data-tool="${toolId}"]`);
  const tool = TOOLS.find((candidate) => candidate.id === toolId);
  const label = i18n.t(tool?.labelKey ?? "ui.tools.select.label");
  const description = i18n.t(tool?.descriptionKey ?? "ui.tools.select.description");
  const key = button?.querySelector("kbd")?.textContent ?? "";
  byId("tool-status").textContent = i18n.t("ui.tools.status", { tool: label, description, shortcut: i18n.t("ui.tools.shortcut", { key }) });
  renderActiveToolStatus();
  artboard.dataset.tool = toolId;
}, { t: i18n.t });

new CanvasController(artboard, {
  getDocument: () => currentDocument,
  getTool: () => activeTool,
  getSelectedIds: () => [...selectedIds],
  select: selectObjectWithOptions,
  selectMany: selectObjects,
  deselect: () => selectObject(null),
  notify: showNotice,
  revealInspector,
  contextMenu: showObjectContextMenu,
  update: (id, patch) => {
    selectedId = id;
    const element = currentDocument.elements.find((candidate) => candidate.id === id);
    if (currentDocument.layers.find((layer) => layer.id === element?.layerId)?.locked) {
      showNotice("A camada está bloqueada. Desbloqueie-a para mover ou transformar este objeto.");
      return;
    }
    updateSelected(patch, false);
  },
  updateMany: (updates) => updateMany(updates, false),
  commit: commitHistory
});

installShortcuts({
  setTool: (toolId) => toolbar.setTool(toolId),
  undo: () => {
    const previous = history.undo();
    if (previous) restoreDocument(previous);
  },
  redo: () => {
    const next = history.redo();
    if (next) restoreDocument(next);
  },
  export: () => {
    try { exportSvg(); } catch (error) { showNotice(error); }
  },
  save: () => {
    saveProject().catch((error) => showNotice(error));
  },
  remove: removeSelectedObject,
  duplicate: duplicateSelectedObject,
  copy: copySelectedObjects,
  paste: pasteCopiedObjects,
  addText: () => {
    try { addText(); } catch (error) { showNotice(error); }
  },
  help: showShortcuts,
  deselect: () => selectObject(null)
});
byId("shortcut-help").addEventListener("click", showShortcuts);
byId("shortcuts-dialog").querySelector(".dialog-close").addEventListener("click", () => byId("shortcuts-dialog").close());
byId("open-path-editor").addEventListener("click", openPathEditor);
byId("edit-image").addEventListener("click", () => {
  void openImageEditor().catch((error) => showNotice(error));
});
byId("open-image-vectorizer").addEventListener("click", openImageVectorizer);
byId("apply-image-vector").addEventListener("click", applyImageVectorization);
byId("apply-image-edit").addEventListener("click", () => {
  void applyImageEdit().catch((error) => showNotice(error));
});
byId("cancel-image-edit").addEventListener("click", () => byId("image-edit-dialog").close());
byId("image-edit-dialog").addEventListener("close", () => {
  rasterImageEditor?.destroy();
  rasterImageEditor = null;
  pendingImageEdit = null;
  byId("image-editor-container").replaceChildren();
  byId("apply-image-edit").disabled = true;
});
byId("image-vector-dialog").addEventListener("close", () => {
  imageVectorPreviewSequence += 1;
  cancelImageTracePreview();
  imageVectorResult = null;
  imageVectorColors = new Set();
  imageVectorSourceId = null;
  byId("image-vector-color-options").replaceChildren();
});
for (const id of [
  "image-vector-colors", "image-vector-pathomit",
  "image-vector-line-tolerance", "image-vector-curve-tolerance"
]) {
  byId(id).addEventListener("input", () => {
    void updateImageVectorPreview();
  });
}
byId("image-vector-border-mode").addEventListener("change", updateImageVectorStyleControls);
byId("image-vector-border-width").addEventListener("input", updateImageVectorStyleControls);
installTooltips();
projectNameInput.addEventListener("input", () => {
  projectNameIsUserValue = true;
});
languageSelect.addEventListener("change", () => {
  i18n.setLocale(languageSelect.value);
  try { localStorage.setItem("commburn.locale", i18n.locale); } catch {}
  applyInterfaceLocale();
});
applyInterfaceLocale();
new ResizeObserver(() => resizeBoard()).observe(stage);

function renderZoomControls() {
  zoomResetButton.textContent = zoomPercent(viewZoom);
  zoomOutButton.disabled = viewZoom <= ZOOM_MIN;
  zoomInButton.disabled = viewZoom >= ZOOM_MAX;
}

// Changes the view zoom only; the project and its millimetre values are untouched.
// The content point under `anchor` (client coordinates) stays in place; by default that is the visible centre.
function setViewZoom(level, anchor = null) {
  const nextZoom = clampZoom(level);
  if (nextZoom === viewZoom) return;
  const stageBox = stage.getBoundingClientRect();
  const before = artboard.getBoundingClientRect();
  const point = anchor ?? {
    x: stageBox.left + stage.clientLeft + stage.clientWidth / 2,
    y: stageBox.top + stage.clientTop + stage.clientHeight / 2
  };
  viewZoom = nextZoom;
  resizeBoard();
  renderZoomControls();
  const after = artboard.getBoundingClientRect();
  stage.scrollLeft += scrollDeltaToKeepAnchor(point.x, { start: before.left, size: before.width }, { start: after.left, size: after.width });
  stage.scrollTop += scrollDeltaToKeepAnchor(point.y, { start: before.top, size: before.height }, { start: after.top, size: after.height });
}

zoomOutButton.addEventListener("click", () => setViewZoom(zoomByFactor(viewZoom, 1 / ZOOM_STEP)));
zoomInButton.addEventListener("click", () => setViewZoom(zoomByFactor(viewZoom, ZOOM_STEP)));
zoomResetButton.addEventListener("click", () => setViewZoom(ZOOM_DEFAULT));
// Ctrl/Cmd + wheel (and trackpad pinch, which browsers report the same way) zooms the stage around the pointer.
stage.addEventListener("wheel", (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  setViewZoom(zoomByFactor(viewZoom, Math.exp(-event.deltaY * 0.002)), { x: event.clientX, y: event.clientY });
}, { passive: false });
renderZoomControls();

for (const button of document.querySelectorAll('[data-action="new"]')) button.addEventListener("click", addDocumentTab);
for (const button of document.querySelectorAll('[data-action="import-svg"]')) {
  button.addEventListener("click", () => byId("svg-file-input").click());
}
byId("svg-file-input").addEventListener("change", async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file?.type === "image/svg+xml" || file?.name.toLowerCase().endsWith(".svg")) {
      await importSvgFile(file);
    } else if (file?.type === "application/json" || file?.name.toLowerCase().endsWith(".json")) {
      await importProjectFile(file);
    } else {
      await openImageEditor(file);
    }
  } catch (error) {
    showNotice(error);
  } finally {
    event.target.value = "";
  }
});
for (const button of document.querySelectorAll('[data-action="export"]')) button.addEventListener("click", () => {
  try { exportSvg(); } catch (error) { showNotice(error); }
});
for (const button of document.querySelectorAll('[data-action="export-project"], [data-action="save-project"]')) button.addEventListener("click", () => {
  saveProject().catch((error) => showNotice(error));
});
for (const button of document.querySelectorAll('[data-action="preview-machine"]')) {
  button.addEventListener("click", showMachinePreview);
}
byId("preview-machine-job").addEventListener("click", showMachinePreview);
for (const button of document.querySelectorAll('[data-action="export-gcode"]')) {
  button.addEventListener("click", async () => {
    try { await exportGcode(); } catch (error) {
      showNotice(error instanceof FieldValidationError
        ? error
        : `Não foi possível exportar G-code: ${formatError(error)}`);
    }
  });
}
byId("machine-preview-dialog").querySelector(".dialog-close").addEventListener("click", () => byId("machine-preview-dialog").close());
byId("start-presentation").addEventListener("click", beginPresentation);
byId("presentation-exit").addEventListener("click", finishPresentation);
byId("presentation-restart").addEventListener("click", restartPresentation);
byId("presentation-toggle").addEventListener("click", togglePresentationPlayback);
byId("machine-preview-dialog").addEventListener("close", () => {
  if (presentationInternalClose) {
    presentationInternalClose = false;
  } else if (presentationActive) {
    finishPresentation();
  }
});
document.addEventListener("keydown", (event) => {
  if (!presentationActive || event.target.closest?.("#presentation-card")) return;
  if (event.key === "Tab" || event.key === "Shift" || event.key === "Enter" || event.key === " ") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.key === "Escape") finishPresentation();
}, true);
byId("refresh-ports").addEventListener("click", async () => {
  try {
    const { warning } = await refreshPorts();
    showNotice(warning ?? "Lista de portas seriais atualizada.");
  } catch (error) {
    showNotice(error);
  }
});
connectButton.addEventListener("click", async () => {
  try {
    if (!serialPathInput.value.trim()) throw new Error("Informe o caminho da porta serial.");
    const selectedBaudRate = byId("baud-rate").value;
    const result = await machineApi("/api/connect", "POST", {
      path: serialPathInput.value.trim(),
      baudRate: selectedBaudRate === "auto" ? "auto" : Number(selectedBaudRate)
    });
    machineConnected = result.connected;
    machineSimulation = false;
    if (result.autoDetected) byId("baud-rate").value = String(result.baudRate);
    byId("machine-smax").value = "";
    setMachineState("ui.machine.connectedAt", () => ({ path: result.path, baud: i18n.t(result.autoDetected ? "ui.machine.baudDetected" : "ui.machine.baudSelected", { rate: result.baudRate }) }));
    reportControllerSettings(result);
    updateMachineControls();
  } catch (error) {
    setMachineState("ui.machine.connectionFailure", () => ({ error: formatError(error) }));
    showNotice(error);
  }
});
byId("read-machine-settings").addEventListener("click", async () => {
  try {
    const result = await machineApi("/api/settings", "POST", {});
    reportControllerSettings(result);
  } catch (error) {
    reportControllerSettings({ settingsError: formatError(error) });
  }
});
// $130 and $131 are the maximum travel in mm. Only the bed size changes; origin and axis direction stay user-controlled.
byId("read-machine-area").addEventListener("click", async () => {
  try {
    const { settings, settingsError } = await machineApi("/api/settings", "POST", {});
    const area = machineAreaFromSettings(settings);
    if (!area) {
      showNotice(settingsError ?? i18n.t("ui.machine.areaInvalid"));
      return;
    }
    widthInput.value = String(area.widthMm);
    heightInput.value = String(area.heightMm);
    renderDocumentFields(true);
    showNotice(i18n.t("ui.machine.areaRead", { width: area.widthMm, height: area.heightMm }));
  } catch (error) {
    showNotice(formatError(error));
  }
});
simulateMachineButton.addEventListener("click", async () => {
  try {
    const result = await machineApi("/api/simulate-connect", "POST", {});
    machineConnected = result.connected;
    machineSimulation = result.simulated;
    setMachineState("ui.machine.simulatedConnected");
    updateMachineControls();
  } catch (error) {
    setMachineState("ui.machine.simulationFailure", () => ({ error: formatError(error) }));
    showNotice(error);
  }
});
disconnectButton.addEventListener("click", async () => {
  try {
    await machineApi("/api/disconnect", "POST", {});
    machineConnected = false;
    machineSimulation = false;
    setMachineState("ui.machine.disconnected");
    updateMachineControls();
  } catch (error) {
    showNotice(error);
  }
});
safetyCheckbox.addEventListener("change", updateMachineControls);
// Placement options do not change the document, so only the markers are redrawn and the sidebar keeps its scroll.
function refreshPlacement() {
  keepScrollPositions(() => {
    updateMachineControls();
    drawJobMarkers(currentDocument);
  });
}
byId("start-mode").addEventListener("change", () => {
  byId("start-anchor-field").hidden = byId("start-mode").value !== "head";
  refreshPlacement();
});
byId("start-anchor-field").hidden = byId("start-mode").value !== "head";
for (const id of ["show-job-markers", "start-anchor", "work-system"]) byId(id).addEventListener("change", refreshPlacement);
byId("read-position").addEventListener("click", async () => {
  try {
    const { position } = await machineApi("/api/position");
    const format = (value) => value === undefined || value === null ? "?" : value.toFixed(3);
    byId("machine-position").textContent = position?.work
      ? i18n.t("ui.machine.positionRead", { mx: format(position.machine?.xMm), my: format(position.machine?.yMm), wx: format(position.work.xMm), wy: format(position.work.yMm) })
      : i18n.t("ui.machine.positionMachineOnly", { mx: format(position?.machine?.xMm), my: format(position?.machine?.yMm) });
  } catch (error) {
    showNotice(error);
  }
});
byId("set-zero").addEventListener("click", async () => {
  try {
    const system = byId("work-system").value || "G54";
    await machineApi("/api/set-zero", "POST", { slot: Number(system.slice(1)) - 53 });
    showNotice(i18n.t("ui.machine.zeroSet", { slot: system }));
  } catch (error) {
    showNotice(error);
  }
});
byId("home-machine").addEventListener("click", async () => {
  try {
    if (!window.confirm(i18n.t("ui.machine.homeConfirm"))) return;
    await machineApi("/api/home", "POST", { confirmed: true });
    showNotice(i18n.t("ui.machine.homed"));
  } catch (error) {
    showNotice(error);
  }
});
byId("machine-smax").addEventListener("input", updateMachineControls);
startMachineButton.addEventListener("click", async () => {
  try {
    if (missingFontElementIds.size > 0) throw new Error(i18n.t("ui.machine.missingFontBlocked", { count: missingFontElementIds.size }));
    if (!machineSimulation && !safetyCheckbox.checked) throw new Error(i18n.t("ui.machine.confirmSafety"));
    const documentModel = readDocument();
    await prepareRasters(documentModel);
    const settings = { maxSpindleSpeed: machineMaxSpindleSpeed(machineSimulation), controllerLaserMode, ...readJobPlacement() };
    const plan = planGrblJob(documentModel, settings);
    const result = await machineApi("/api/job", "POST", {
      safetyConfirmed: safetyCheckbox.checked,
      document: documentModel,
      settings
    });
    machineBusy = true;
    machineJobPaused = false;
    machineJobStopRequested = false;
    setMachineState(machineSimulation ? "ui.machine.simulationAccepted" : "ui.machine.jobAccepted", { lines: result.lines });
    showMachineSimulation(plan, documentModel, result.lines, { live: true, simulated: machineSimulation });
    updateMachineControls();
    startMachinePolling();
    await pollMachineJob();
  } catch (error) {
    setMachineState("ui.machine.rejected", () => ({ error: formatError(error) }));
    showNotice(error);
  }
});

await Promise.all(["CommBurn Sans", "CommBurn Serif", "CommBurn Mono"].map((family) => document.fonts.load(`16px "${family}"`)));
renderPreview();
updateMachineControls();
void restoreMachineConnection();
void loadDesktopPlugins({
  i18n,
  documentApi: (plugin) => Object.freeze({
    get: () => structuredClone(readDocument()),
    addElement(element) {
      if (!element || typeof element !== "object" || Array.isArray(element)) {
        throw new TypeError("O plugin deve fornecer um objeto vetorial válido.");
      }
      const documentModel = readDocument();
      const layerId = element.layerId ?? activeLayerId;
      const layer = documentModel.layers.find((candidate) => candidate.id === layerId);
      if (!layer || layer.locked) throw new Error("O plugin precisa usar uma camada desbloqueada.");
      const id = element.id ?? `plugin-${plugin.id}-${nextId++}`;
      const nextElement = { ...element, id, layerId };
      currentDocument = createDocument({ ...documentModel, elements: [...documentModel.elements, nextElement] });
      selectedId = id;
      selectedIds = [id];
      syncInspector();
      renderPreview();
      commitHistory();
      return id;
    }
  }),
  notify: showNotice
}).then(({ errors }) => {
  if (errors.length === 0) return;
  console.warn("CommBurn plugin errors:", errors);
  showNotice(`Falha ao carregar plugins: ${errors.map(({ id }) => id).join(", ")}`);
}).catch((error) => {
  console.warn("Unable to load CommBurn plugins:", error);
  showNotice(`Não foi possível carregar plugins locais: ${formatError(error)}`);
});
