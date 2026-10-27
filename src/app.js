import { createDocument, planGrblJob, renderSvg } from "./core/document.js";
import { vectorizePixels } from "./core/image-vectorize.js";
import { importTracedImageSvg } from "./core/image-trace.js";
import { parseProject, serializeProject } from "./core/project.js";
import { ImageEditor as RasterImageEditor } from "../node_modules/@jodit/image-editor/dist/jodit-image-editor.js";
import { CanvasController } from "./ui/canvas-controller.js";
import { DocumentHistory } from "./ui/history.js";
import { installShortcuts, SHORTCUTS } from "./ui/shortcuts.js";
import { connectToolbar } from "./ui/toolbar.js";
import { installTooltips } from "./ui/tooltips.js";
import { LayersPanel } from "./ui/layers-panel.js";
import { PathEditor } from "./ui/path-editor.js";
import { getSvgViewport, importSvgTree, sanitizeSvgForVisual, validateSvgSource } from "./core/svg-import.js";
import { selectMany as mergeSelection, selectOne } from "./ui/selection.js";

const byId = (id) => document.getElementById(id);
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
const flipXInput = byId("flip-x");
const flipYInput = byId("flip-y");
const textInput = byId("text-content");
const fontFamilyInput = byId("font-family");
const fontSizeInput = byId("font-size");
const artboard = byId("artboard");
const boardFrame = byId("board-frame");
const stage = boardFrame.parentElement;
const objects = byId("objects");
const removeButton = byId("remove-selection");
const selectionStatus = byId("selection-status");
const notice = byId("notice");
const serialPathInput = byId("serial-path");
const connectButton = byId("connect-machine");
const disconnectButton = byId("disconnect-machine");
const startMachineButton = byId("start-machine-job");
const holdMachineButton = byId("hold-machine-job");
const machineState = byId("machine-state");
const safetyCheckbox = byId("safety-confirmed");

let currentDocument = createDocument({ widthMm: 180, heightMm: 120 });
let selectedId = null;
let selectedIds = [];
let activeLayerId = currentDocument.layers[0].id;
let nextId = 1;
let copiedElements = [];
let pasteSequence = 0;
let activeTool = "select";
let imageVectorSourceId = null;
let imageVectorResult = null;
let imageVectorPreviewSequence = 0;
let imageTraceCancellation = null;
let rasterImageEditor = null;
let pendingImageEdit = null;
let noticeTimer;
let machineConnected = false;
let machineBusy = false;
let statusPollTimer;
const history = new DocumentHistory(currentDocument);
const pathEditor = new PathEditor(byId("path-editor-dialog"));

function readDocument() {
  return createDocument({
    widthMm: Number(widthInput.value),
    heightMm: Number(heightInput.value),
    origin: { corner: originInput.value, flipX: flipXInput.checked, flipY: flipYInput.checked },
    layers: currentDocument.layers,
    elements: currentDocument.elements
  });
}

function numberFrom(input, label, min = -Infinity) {
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < min) {
    throw new RangeError(`${label} deve ser ${min > 0 ? "maior que zero" : "um número válido"}.`);
  }
  return value;
}

function commitHistory() {
  history.push(currentDocument);
}

function formatMm(value) {
  return `${Number(value.toFixed(1))}`;
}

function renderRuler(container, lengthMm, vertical = false) {
  container.replaceChildren();
  for (let index = 0; index <= 4; index += 1) {
    const mark = document.createElement("span");
    mark.className = "ruler-mark";
    mark.textContent = formatMm(lengthMm * index / 4) + (index === 4 ? " mm" : "");
    mark.style[vertical ? "top" : "left"] = `${index * 25}%`;
    container.append(mark);
  }
}

function resizeBoard(widthMm = currentDocument.widthMm, heightMm = currentDocument.heightMm) {
  const ratio = widthMm / heightMm;
  const availableWidth = Math.max(0, stage.clientWidth - 72);
  const availableHeight = Math.max(0, stage.clientHeight - 24);
  const drawingWidth = Math.min(1100, availableWidth - 42, availableHeight * ratio);
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
  const isText = selected?.type === "text";
  const isPath = selected?.type === "path";
  const isImage = selected?.type === "image";
  byId("text-inspector-fields").hidden = !isText;
  byId("path-inspector-fields").hidden = !isPath;
  byId("image-inspector-fields").hidden = !isImage;
  byId("single-selection-fields").hidden = isMultiple;
  byId("multi-selection-message").hidden = !isMultiple;
  renderLayers();
  if (!selected) return;
  if (isMultiple) {
    byId("inspector-kind").textContent = `${selectedElements.length} objetos selecionados`;
    const hasLockedLayer = selectedElements.some((element) =>
      currentDocument.layers.find((layer) => layer.id === element.layerId)?.locked
    );
    removeButton.disabled = hasLockedLayer;
    byId("duplicate-selection").disabled = hasLockedLayer;
    return;
  }

  byId("inspector-kind").textContent = `${selected.type} · ${selected.id}`;
  byId("shape-properties").hidden = isText;
  byId("object-text").value = isText ? selected.text : "";
  byId("object-font").value = selected.fontFamily ?? "sans-serif";
  byId("object-x").value = selected.xMm;
  byId("object-y").value = selected.yMm;
  byId("object-width").value = selected.widthMm ?? "";
  byId("object-height").value = selected.heightMm ?? "";
  byId("object-rotation").value = selected.rotationDeg;
  byId("object-skew-x").value = selected.skewXDeg;
  byId("object-skew-y").value = selected.skewYDeg;
  const layerLocked = currentDocument.layers.find((layer) => layer.id === selected.layerId)?.locked ?? false;
  for (const input of inspector.querySelectorAll("input, textarea, select, button")) {
    input.disabled = layerLocked && input.id !== "object-layer";
  }
  byId("object-layer").replaceChildren(...currentDocument.layers.map((layer) => new Option(layer.name, layer.id)));
  byId("object-layer").value = selected.layerId;
  const imageLayer = currentDocument.layers.find((layer) => layer.id === selected.layerId);
  byId("open-image-vectorizer").disabled = !isImage || layerLocked || imageLayer?.operation !== "engrave";
  byId("open-image-vectorizer").title = imageLayer?.operation === "engrave"
    ? "Converter esta imagem em trajetórias vetoriais com potência variável."
    : "A conversão tonal exige uma camada configurada como Gravação.";
  removeButton.disabled = layerLocked;
  byId("duplicate-selection").disabled = layerLocked;
}

function renderLayers() {
  layersPanel?.render(currentDocument.layers, currentDocument.elements, activeLayerId);
  updateMachineControls();
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
    showNotice(error.message);
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
    showNotice(error.message);
  }
}

function showNotice(message) {
  notice.textContent = message;
  notice.classList.add("visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove("visible"), 3000);
}

async function machineApi(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Machine request failed (${response.status})`);
  return result;
}

function updateMachineControls() {
  const maxSpindleSpeed = Number(byId("machine-smax").value);
  const enabledLayers = currentDocument.layers.filter((layer) => layer.enabled);
  const settingsAreValid = Number.isFinite(maxSpindleSpeed) && maxSpindleSpeed > 0 && enabledLayers.length > 0;
  connectButton.disabled = machineConnected;
  disconnectButton.disabled = !machineConnected || machineBusy;
  serialPathInput.disabled = machineConnected;
  byId("baud-rate").disabled = machineConnected;
  startMachineButton.disabled = !machineConnected || !safetyCheckbox.checked || !settingsAreValid || machineBusy;
  holdMachineButton.disabled = !machineConnected || !machineBusy;
}

async function refreshPorts() {
  const { ports } = await machineApi("/api/ports");
  const options = byId("serial-port-options");
  options.replaceChildren(...ports.map((port) => {
    const option = document.createElement("option");
    option.value = port.path;
    option.label = [port.path, port.manufacturer].filter(Boolean).join(" — ");
    return option;
  }));
  if (ports.length === 0) machineState.textContent = "Nenhuma porta serial encontrada.";
}

async function pollMachineJob() {
  try {
    const result = await machineApi("/api/job-status");
    if (result.state === "running") {
      machineState.textContent = `Enviando comandos: ${result.completed}/${result.total}`;
      return;
    }
    clearInterval(statusPollTimer);
    statusPollTimer = undefined;
    machineBusy = false;
    if (result.state === "complete") {
      machineState.textContent = "Trabalho enviado e confirmado pelo controlador.";
      showNotice("Envio finalizado. Confirme a máquina antes de iniciar outro trabalho.");
    } else if (result.state === "stopped") {
      machineState.textContent = `Envio interrompido: ${result.error}`;
      showNotice(`Envio interrompido: ${result.error}`);
    } else {
      machineState.textContent = "Conectado ao controlador GRBL.";
    }
    updateMachineControls();
  } catch (error) {
    clearInterval(statusPollTimer);
    statusPollTimer = undefined;
    machineBusy = false;
    machineState.textContent = `Falha ao consultar o controlador: ${error.message}`;
    updateMachineControls();
  }
}

function renderPreview() {
  try {
    currentDocument = readDocument();
    const { widthMm, heightMm } = currentDocument;
    artboard.setAttribute("viewBox", `0 0 ${widthMm} ${heightMm}`);
    artboard.setAttribute("preserveAspectRatio", "xMidYMid meet");
    renderRuler(byId("ruler-x"), widthMm);
    renderRuler(byId("ruler-y"), heightMm, true);
    resizeBoard(widthMm, heightMm);
    byId("canvas-size").textContent = `${widthMm} × ${heightMm} mm`;

    const svgDocument = new DOMParser().parseFromString(renderSvg(currentDocument), "image/svg+xml");
    if (svgDocument.querySelector("parsererror")) throw new Error("Não foi possível desenhar este documento.");
    const selection = new Set(selectedIds);
    const nodes = Array.from(svgDocument.querySelectorAll("[id]"), (node) => {
      const imported = document.importNode(node, true);
      imported.dataset.id = imported.getAttribute("id");
      imported.dataset.layerId = node.closest("[data-layer-id]")?.getAttribute("data-layer-id") ?? "";
      const layer = currentDocument.layers.find((candidate) => candidate.id === imported.dataset.layerId);
      if (layer?.locked) imported.dataset.locked = "true";
      if (selection.has(imported.dataset.id)) imported.classList.add("selected");
      return imported;
    });
    objects.replaceChildren(...nodes);
    selectionStatus.textContent = selectedIds.length === 0
      ? "Nenhum objeto selecionado"
      : selectedIds.length === 1
        ? `Selecionado: ${selectedId}`
        : `${selectedIds.length} objetos selecionados`;
    const selected = currentDocument.elements.filter((element) => selectedIds.includes(element.id));
    const hasLockedLayer = selected.some((element) =>
      currentDocument.layers.find((layer) => layer.id === element.layerId)?.locked
    );
    removeButton.disabled = selected.length === 0 || hasLockedLayer;
    byId("duplicate-selection").disabled = selected.length === 0 || hasLockedLayer;
    renderLayers();
  } catch (error) {
    showNotice(error.message);
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
    fontFamily: fontFamilyInput.value,
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

function exportSvg() {
  const svg = renderSvg(readDocument());
  downloadFile(svg, "commburn-trabalho.svg", "image/svg+xml;charset=utf-8");
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

function exportProject() {
  const source = serializeProject(readDocument());
  downloadFile(source, "commburn-trabalho.commburn.json", "application/json;charset=utf-8");
  showNotice("Projeto editável salvo com camadas e objetos.");
}

function createMachinePlan() {
  return planGrblJob(readDocument(), {
    maxSpindleSpeed: numberFrom(byId("machine-smax"), "Velocidade máxima S", Number.MIN_VALUE)
  });
}

function drawMachinePreview(plan) {
  const svg = byId("machine-path-preview");
  const documentModel = readDocument();
  svg.setAttribute("viewBox", `0 0 ${documentModel.widthMm} ${documentModel.heightMm}`);
  svg.style.aspectRatio = `${documentModel.widthMm} / ${documentModel.heightMm}`;
  svg.replaceChildren();
  const layerColors = new Map(documentModel.layers.map((layer) => [layer.id, layer.color]));
  for (const plannedPath of plan.paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const [first, ...rest] = plannedPath.points;
    path.setAttribute("d", `M${first.xMm} ${first.yMm}${rest.map((point) => ` L${point.xMm} ${point.yMm}`).join("")}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", plannedPath.kind === "travel" ? "#8994a4" : layerColors.get(plannedPath.layerId));
    path.setAttribute("stroke-width", plannedPath.kind === "travel" ? "0.35" : "0.6");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    if (plannedPath.kind === "travel") path.setAttribute("stroke-dasharray", "3 2");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = plannedPath.kind === "travel"
      ? "Deslocamento rápido entre trajetórias; laser desligado"
      : `${plannedPath.operation} · ${plannedPath.elementId} · passe ${plannedPath.pass}`;
    path.append(title);
    svg.append(path);
  }
  const stats = plan.stats;
  byId("machine-preview-stats").textContent =
    `${stats.workPathCount} trajetórias de trabalho · ${stats.rapidMoveCount} saltos rápidos · `
    + `${stats.workDistanceMm.toFixed(1)} mm de trabalho · ${stats.travelDistanceMm.toFixed(1)} mm de deslocamento conhecido`;
  byId("machine-preview-code").textContent = plan.gcode;
}

function showMachinePreview() {
  try {
    const plan = createMachinePlan();
    drawMachinePreview(plan);
    byId("machine-preview-dialog").showModal();
  } catch (error) {
    showNotice(`Não foi possível gerar a prévia GRBL: ${error.message}`);
  }
}

function exportGcode() {
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
  if (!globalThis.svgson?.parseSync || !globalThis.svgson?.stringify) throw new Error("O parser SVG local não foi carregado.");

  const source = await file.text();
  const sanitizedSource = validateSvgSource(source);
  const tree = globalThis.svgson.parseSync(sanitizedSource);
  if (byId("svg-import-mode").value === "visual") {
    const viewport = getSvgViewport(tree);
    const sanitized = sanitizeSvgForVisual(tree, globalThis.svgson);
    const svgDataUri = encodeSvgDataUri(sanitized.source);
    const fit = Math.min(1, currentDocument.widthMm / viewport.widthMm, currentDocument.heightMm / viewport.heightMm);
    const element = {
      id: `svg-image-${nextId++}`,
      type: "svg-image",
      xMm: 0,
      yMm: 0,
      widthMm: viewport.widthMm * fit,
      heightMm: viewport.heightMm * fit,
      svgDataUri,
      layerId: activeLayerId
    };
    currentDocument = createDocument({ ...readDocument(), elements: [...currentDocument.elements, element] });
    selectedIds = [element.id];
    selectedId = element.id;
    syncInspector();
    renderPreview();
    commitHistory();
    showNotice(sanitized.removedActiveContent
      ? "SVG visual incorporado. Scripts e eventos foram removidos; conteúdo externo não é carregado."
      : "SVG importado como objeto visual incorporado, sem execução de scripts nem conteúdo remoto.");
    return;
  }

  const imported = importSvgTree(tree, {
    layerId: activeLayerId,
    forceLayerId: activeLayerId,
    idPrefix: `svg-${nextId}`
  });
  const elements = [...currentDocument.elements, ...imported.elements];
  currentDocument = createDocument({
    ...currentDocument,
    widthMm: Math.max(currentDocument.widthMm, imported.widthMm),
    heightMm: Math.max(currentDocument.heightMm, imported.heightMm),
    layers: [...currentDocument.layers, ...imported.layers.filter((candidate) => candidate.id !== activeLayerId)],
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
  showNotice(`SVG importado: ${imported.elements.length} objeto(s) editável(is), em milímetros.`);
}

async function importProjectFile(file) {
  if (file.size === 0 || file.size > 50 * 1024 * 1024) {
    throw new RangeError("O projeto deve ter entre 1 byte e 50 MB.");
  }
  const imported = parseProject(await file.text());
  currentDocument = imported;
  activeLayerId = imported.layers[0].id;
  selectedIds = [];
  selectedId = null;
  widthInput.value = imported.widthMm;
  heightInput.value = imported.heightMm;
  originInput.value = imported.origin.corner;
  flipXInput.checked = imported.origin.flipX;
  flipYInput.checked = imported.origin.flipY;
  history.reset(imported);
  syncInspector();
  renderPreview();
  showNotice("Projeto CommBurn carregado e validado.");
}

function encodeSvgDataUri(source) {
  const bytes = new TextEncoder().encode(source);
  if (bytes.length > 10 * 1024 * 1024) throw new RangeError("O SVG sanitizado deve ter no máximo 10 MB.");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
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
    const layer = currentDocument.layers.find((candidate) => candidate.id === activeLayerId);
    if (!layer || layer.locked) throw new Error("Selecione uma camada desbloqueada para importar objetos.");
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
  const widthMm = Number(widthInputMm.value);
  const heightMm = Number(heightInputMm.value);
  if (!widthInputMm.checkValidity() || !heightInputMm.checkValidity()
    || !Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
    throw new RangeError("Informe largura e altura positivas em milímetros.");
  }
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
    const input = byId(id);
    const value = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(value) || !input.checkValidity()) {
      throw new RangeError(`${label} deve estar dentro do intervalo indicado.`);
    }
    return value;
  };
  const pitchMm = readNumber("image-vector-pitch", "Espaçamento");
  const minimumPowerPercent = readNumber("image-vector-min-power", "Potência mínima");
  const maximumPowerPercent = readNumber("image-vector-max-power", "Potência máxima");
  const colorTolerance = readNumber("image-vector-tolerance", "Tolerância de cor");
  const mode = byId("image-vector-mode").value;
  return {
    xMm: element.xMm,
    yMm: element.yMm,
    widthMm: element.widthMm,
    heightMm: element.heightMm,
    pitchMm,
    mode,
    layerId: element.layerId,
    idPrefix: `vector-${crypto.randomUUID()}`,
    targetColor: byId("image-vector-color").value,
    colorTolerance,
    minimumPowerPercent,
    maximumPowerPercent,
    traceOptions: mode === "trace" ? {
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
    } : null
  };
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
    throw new RangeError("Redefina rotação e distorção da imagem antes de converter.");
  }
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(element.imageDataUri);
  if (!match) throw new TypeError("A imagem incorporada tem um formato inválido.");
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: `image/${match[1]}` }));
  if (bitmap.width * bitmap.height > 20_000_000) {
    bitmap.close();
    throw new RangeError("A imagem excede o limite de 20 milhões de pixels para conversão.");
  }
  const options = imageConversionOptions(element);
  const pixelWidth = Math.max(1, Math.ceil(element.widthMm / options.pitchMm));
  const pixelHeight = Math.max(1, Math.ceil(element.heightMm / options.pitchMm));
  if (pixelWidth * pixelHeight > 2_000_000) {
    bitmap.close();
    throw new RangeError("A prévia ultrapassaria 2 milhões de amostras; aumente o espaçamento.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error("O navegador não disponibilizou o canvas necessário para processar a imagem.");
  }
  try {
    context.imageSmoothingQuality = "high";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pixelWidth, pixelHeight);
    context.drawImage(bitmap, 0, 0, pixelWidth, pixelHeight);
  } finally {
    bitmap.close();
  }
  const pixels = context.getImageData(0, 0, pixelWidth, pixelHeight);
  if (options.mode === "trace") {
    const traceSvg = await traceImageData(pixels, pixelWidth, pixelHeight, options.traceOptions);
    if (!globalThis.svgson?.parseSync || !globalThis.svgson?.stringify) {
      throw new Error("O parser SVG local não foi carregado para converter os contornos.");
    }
    const tree = globalThis.svgson.parseSync(validateSvgSource(traceSvg));
    const sourceLayer = currentDocument.layers.find((layer) => layer.id === element.layerId);
    const imported = importTracedImageSvg(tree, {
      widthMm: element.widthMm,
      heightMm: element.heightMm,
      minimumPowerPercent: options.minimumPowerPercent,
      maximumPowerPercent: options.maximumPowerPercent,
      sourceLayer,
      idPrefix: `trace-${crypto.randomUUID()}`
    });
    const previewTree = {
      ...tree,
      attributes: { ...tree.attributes, width: `${pixelWidth}px`, height: `${pixelHeight}px` },
      children: tree.children.map((node) => node.type === "element" && node.name === "path"
        ? {
          ...node,
          attributes: {
            ...node.attributes,
            fill: "none",
            stroke: node.attributes.fill ?? node.attributes.stroke
          }
        }
        : node)
    };
    return {
      mode: "trace",
      elements: imported.elements,
      layers: imported.layers,
      preview: {
        svg: globalThis.svgson.stringify(previewTree),
        width: pixelWidth,
        height: pixelHeight
      },
      stats: { ...imported.stats, pixelWidth, pixelHeight }
    };
  }
  return vectorizePixels(pixels.data, pixelWidth, pixelHeight, options);
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

async function updateImageVectorPreview() {
  const sequence = ++imageVectorPreviewSequence;
  cancelImageTracePreview();
  imageVectorResult = null;
  byId("apply-image-vector").disabled = true;
  const source = currentDocument.elements.find((element) => element.id === imageVectorSourceId);
  if (!source || source.type !== "image") return;
  try {
    const result = await vectorizeImageElement(source);
    if (sequence !== imageVectorPreviewSequence) return;
    if (result.preview.svg) {
      await drawTracePreview(result.preview);
    } else {
      const canvas = byId("image-vector-preview");
      canvas.width = result.preview.width;
      canvas.height = result.preview.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("O navegador não disponibilizou o canvas de prévia.");
      context.putImageData(new ImageData(result.preview.data, result.preview.width, result.preview.height), 0, 0);
    }
    if (sequence !== imageVectorPreviewSequence) return;
    imageVectorResult = result;
    byId("image-vector-stats").textContent = result.mode === "trace"
      ? `${result.stats.pathCount} contornos em ${result.stats.colorCount} cores · ${result.stats.pixelWidth} × ${result.stats.pixelHeight} amostras.`
      : `${result.stats.pathCount} trajetórias · ${result.stats.pixelWidth} × ${result.stats.pixelHeight} amostras · potência variável por tom.`;
    byId("apply-image-vector").disabled = false;
  } catch (error) {
    if (sequence !== imageVectorPreviewSequence) return;
    byId("image-vector-stats").textContent = `Conversão indisponível: ${error.message}`;
  }
}

function syncImageVectorSettings() {
  const traceMode = byId("image-vector-mode").value === "trace";
  for (const setting of document.querySelectorAll("[data-image-setting]")) {
    setting.hidden = setting.dataset.imageSetting === "trace" ? !traceMode : traceMode;
  }
}

function openImageVectorizer() {
  try {
    const source = currentDocument.elements.find((element) => element.id === selectedId);
    if (!source || source.type !== "image") throw new Error("Selecione uma imagem raster incorporada.");
    const layer = currentDocument.layers.find((candidate) => candidate.id === source.layerId);
    if (!layer || layer.locked) throw new Error("Desbloqueie a camada da imagem antes de convertê-la.");
    if (layer.operation !== "engrave") throw new Error("A conversão tonal exige uma camada configurada como Gravação.");
    imageVectorSourceId = source.id;
    byId("image-vector-dialog").showModal();
    syncImageVectorSettings();
    void updateImageVectorPreview();
  } catch (error) {
    showNotice(error.message);
  }
}

function applyImageVectorization() {
  try {
    const source = currentDocument.elements.find((element) => element.id === imageVectorSourceId);
    const layer = currentDocument.layers.find((candidate) => candidate.id === source?.layerId);
    if (!source || source.type !== "image" || !imageVectorResult) throw new Error("Gere uma prévia válida antes de aplicar.");
    if (!layer || layer.locked || layer.operation !== "engrave") throw new Error("A camada de gravação não está disponível.");
    const resultMode = imageVectorResult.mode;
    const convertedIds = imageVectorResult.elements.map((element) => element.id);
    currentDocument = createDocument({
      ...readDocument(),
      layers: [...currentDocument.layers, ...(imageVectorResult.layers ?? [])],
      elements: [
        ...currentDocument.elements.filter((element) => element.id !== source.id),
        ...imageVectorResult.elements
      ]
    });
    selectedIds = convertedIds.length ? [convertedIds.at(-1)] : [];
    selectedId = convertedIds.at(-1) ?? null;
    activeLayerId = currentDocument.elements.find((element) => element.id === selectedId)?.layerId ?? layer.id;
    syncInspector();
    renderPreview();
    commitHistory();
    byId("image-vector-dialog").close();
    showNotice(resultMode === "trace"
      ? `${convertedIds.length} contorno(s) vetorial(is) criado(s) em camadas por cor.`
      : `${convertedIds.length} trajetória(s) vetorial(is) criada(s) com potência variável.`);
  } catch (error) {
    showNotice(error.message);
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
        showNotice(error.message);
        return false;
      }
    });
  } catch (error) {
    showNotice(error.message);
  }
}

function newDocument() {
  currentDocument = createDocument({ widthMm: 180, heightMm: 120 });
  activeLayerId = currentDocument.layers[0].id;
  widthInput.value = "180";
  heightInput.value = "120";
  originInput.value = "top-left";
  flipXInput.checked = false;
  flipYInput.checked = false;
  selectedId = null;
  selectedIds = [];
  textInput.value = "";
  currentDocument = readDocument();
  syncInspector();
  renderPreview();
  commitHistory();
  showNotice("Novo trabalho criado.");
}

for (const input of [widthInput, heightInput, originInput, flipXInput, flipYInput]) {
  input.addEventListener("input", renderPreview);
  input.addEventListener("change", () => {
    renderPreview();
    commitHistory();
  });
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
    updateSelected({ [property]: numberFrom(input, property, minimum) });
  } else if (input.id === "object-text") {
    updateSelected({ text: input.value }, true, false);
  } else if (input.id === "object-font") {
    updateSelected({ fontFamily: input.value });
  }
}

for (const input of byId("object-inspector").querySelectorAll("input, textarea, select")) {
  input.addEventListener(input.matches("textarea") && input.id === "object-text" ? "input" : "change", () => {
    try {
      updateSelectedFromInput(input);
    } catch (error) {
      showNotice(error.message);
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
  try { addText(); } catch (error) { showNotice(error.message); }
});
byId("add-shape").addEventListener("click", () => {
  try { addShape(); } catch (error) { showNotice(error.message); }
});
removeButton.addEventListener("click", removeSelectedObject);
byId("duplicate-selection").addEventListener("click", duplicateSelectedObject);

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
    showNotice(error.message);
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
    showNotice(error.message);
  }
}

function duplicateLayer(layerId) {
  try {
    const source = currentDocument.layers.find((layer) => layer.id === layerId);
    if (!source) throw new RangeError("A camada a duplicar não foi encontrada.");
    const baseName = `${source.name} (cópia)`;
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
    activeLayerId = duplicate.id;
    selectedIds = duplicatedElements.map((element) => element.id);
    selectedId = selectedIds.at(-1) ?? null;
    syncInspector();
    renderPreview();
    commitHistory();
    showNotice(`Camada "${source.name}" duplicada com ${duplicatedElements.length} objeto(s).`);
  } catch (error) {
    showNotice(error.message);
  }
}

function restoreDocument(snapshot) {
  currentDocument = createDocument(snapshot);
  widthInput.value = currentDocument.widthMm;
  heightInput.value = currentDocument.heightMm;
  originInput.value = currentDocument.origin.corner;
  flipXInput.checked = currentDocument.origin.flipX;
  flipYInput.checked = currentDocument.origin.flipY;
  if (!currentDocument.layers.some((layer) => layer.id === activeLayerId)) activeLayerId = currentDocument.layers[0].id;
  selectedIds = selectedIds.filter((id) => currentDocument.elements.some((element) => element.id === id));
  selectedId = selectedIds.at(-1) ?? null;
  syncInspector();
  renderPreview();
}

function showShortcuts() {
  const list = byId("shortcuts-list");
  list.replaceChildren(...SHORTCUTS.map(({ keys, description }) => {
    const row = document.createElement("tr");
    const keyCell = document.createElement("td");
    const descriptionCell = document.createElement("td");
    keyCell.textContent = keys;
    descriptionCell.textContent = description;
    row.append(keyCell, descriptionCell);
    return row;
  }));
  byId("shortcuts-dialog").showModal();
}

function addLayer() {
  const layerIndex = currentDocument.layers.length + 1;
  const layer = {
    id: `layer-${crypto.randomUUID()}`,
    name: `Camada ${layerIndex}`,
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
  currentDocument = createDocument({ ...currentDocument, layers: [...currentDocument.layers, layer] });
  activeLayerId = layer.id;
  selectedId = null;
  selectedIds = [];
  syncInspector();
  renderPreview();
  commitHistory();
}

const layersPanel = new LayersPanel(byId("layers-list"), {
  onSelect: (layerId) => {
    activeLayerId = layerId;
    selectedId = null;
    selectedIds = [];
    syncInspector();
    renderPreview();
  },
  onAdd: addLayer,
  onUpdate: (layerId, patch) => {
    try {
      currentDocument = createDocument({
        ...currentDocument,
        layers: currentDocument.layers.map((layer) => layer.id === layerId ? { ...layer, ...patch } : layer)
      });
      syncInspector();
      renderPreview();
      commitHistory();
    } catch (error) {
      showNotice(error.message);
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
  const button = byId("action-toolbar").querySelector(`[data-tool="${toolId}"]`);
  const label = button?.querySelector("span:nth-child(2)")?.textContent ?? toolId;
  const key = button?.querySelector("kbd")?.textContent ?? "";
  byId("tool-status").textContent = `${label}: ${button?.dataset.tooltip ?? ""}`;
  byId("active-tool-status").textContent = `${label} · ${key}`;
  artboard.dataset.tool = toolId;
});

new CanvasController(artboard, {
  getDocument: () => currentDocument,
  getTool: () => activeTool,
  getSelectedIds: () => [...selectedIds],
  select: selectObjectWithOptions,
  selectMany: selectObjects,
  deselect: () => selectObject(null),
  notify: showNotice,
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
    try { exportSvg(); } catch (error) { showNotice(error.message); }
  },
  remove: removeSelectedObject,
  duplicate: duplicateSelectedObject,
  copy: copySelectedObjects,
  paste: pasteCopiedObjects,
  addText: () => {
    try { addText(); } catch (error) { showNotice(error.message); }
  },
  help: showShortcuts,
  deselect: () => selectObject(null)
});
byId("shortcut-help").addEventListener("click", showShortcuts);
byId("shortcuts-dialog").querySelector(".dialog-close").addEventListener("click", () => byId("shortcuts-dialog").close());
byId("open-path-editor").addEventListener("click", openPathEditor);
byId("edit-image").addEventListener("click", () => {
  void openImageEditor().catch((error) => showNotice(error.message));
});
byId("open-image-vectorizer").addEventListener("click", openImageVectorizer);
byId("apply-image-vector").addEventListener("click", applyImageVectorization);
byId("apply-image-edit").addEventListener("click", () => {
  void applyImageEdit().catch((error) => showNotice(error.message));
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
  imageVectorSourceId = null;
});
for (const id of [
  "image-vector-mode", "image-vector-pitch", "image-vector-color", "image-vector-tolerance",
  "image-vector-min-power", "image-vector-max-power", "image-vector-colors", "image-vector-pathomit",
  "image-vector-line-tolerance", "image-vector-curve-tolerance"
]) {
  byId(id).addEventListener("input", () => {
    if (id === "image-vector-mode") syncImageVectorSettings();
    void updateImageVectorPreview();
  });
}
installTooltips();
new ResizeObserver(() => resizeBoard()).observe(stage);

for (const button of document.querySelectorAll('[data-action="new"]')) button.addEventListener("click", newDocument);
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
    showNotice(error.message);
  } finally {
    event.target.value = "";
  }
});
for (const button of document.querySelectorAll('[data-action="export"]')) button.addEventListener("click", () => {
  try { exportSvg(); } catch (error) { showNotice(error.message); }
});
for (const button of document.querySelectorAll('[data-action="export-project"]')) button.addEventListener("click", () => {
  try { exportProject(); } catch (error) { showNotice(error.message); }
});
for (const button of document.querySelectorAll('[data-action="preview-machine"]')) {
  button.addEventListener("click", showMachinePreview);
}
for (const button of document.querySelectorAll('[data-action="export-gcode"]')) {
  button.addEventListener("click", () => {
    try { exportGcode(); } catch (error) { showNotice(`Não foi possível exportar G-code: ${error.message}`); }
  });
}
byId("machine-preview-dialog").querySelector(".dialog-close").addEventListener("click", () => byId("machine-preview-dialog").close());
for (const button of document.querySelectorAll('[data-action="add-text"]')) button.addEventListener("click", () => byId("add-text").click());
for (const button of document.querySelectorAll('[data-action="add-rect"]')) button.addEventListener("click", () => byId("add-shape").click());

byId("refresh-ports").addEventListener("click", async () => {
  try {
    await refreshPorts();
    showNotice("Lista de portas seriais atualizada.");
  } catch (error) {
    showNotice(error.message);
  }
});
connectButton.addEventListener("click", async () => {
  try {
    if (!serialPathInput.value.trim()) throw new Error("Informe o caminho da porta serial.");
    const result = await machineApi("/api/connect", "POST", {
      path: serialPathInput.value.trim(),
      baudRate: Number(byId("baud-rate").value)
    });
    machineConnected = result.connected;
    machineState.textContent = `Conectado em ${result.path} a ${result.baudRate} baud. Verifique o firmware e a máquina antes de enviar.`;
    updateMachineControls();
  } catch (error) {
    machineState.textContent = `Falha na conexão: ${error.message}`;
    showNotice(error.message);
  }
});
disconnectButton.addEventListener("click", async () => {
  try {
    await machineApi("/api/disconnect", "POST", {});
    machineConnected = false;
    machineState.textContent = "Desconectado.";
    updateMachineControls();
  } catch (error) {
    showNotice(error.message);
  }
});
safetyCheckbox.addEventListener("change", updateMachineControls);
byId("machine-smax").addEventListener("input", updateMachineControls);
startMachineButton.addEventListener("click", async () => {
  try {
    if (!safetyCheckbox.checked) throw new Error("Confirme a lista de segurança antes de enviar.");
    const result = await machineApi("/api/job", "POST", {
      safetyConfirmed: safetyCheckbox.checked,
      document: readDocument(),
      settings: {
        maxSpindleSpeed: numberFrom(byId("machine-smax"), "Velocidade máxima S", Number.MIN_VALUE)
      }
    });
    machineBusy = true;
    machineState.textContent = `Trabalho aceito: ${result.lines} comandos.`;
    updateMachineControls();
    statusPollTimer = setInterval(pollMachineJob, 500);
    await pollMachineJob();
  } catch (error) {
    machineState.textContent = `Trabalho recusado: ${error.message}`;
    showNotice(error.message);
  }
});
holdMachineButton.addEventListener("click", async () => {
  try {
    await machineApi("/api/hold", "POST", {});
    machineState.textContent = "Pausa solicitada; use a parada de emergência física se houver risco.";
    showNotice("Pausa solicitada ao controlador.");
  } catch (error) {
    showNotice(error.message);
  }
});

renderPreview();
updateMachineControls();
