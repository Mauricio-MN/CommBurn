import { createDocument, renderSvg } from "./core/document.js";
import { CanvasController } from "./ui/canvas-controller.js";
import { DocumentHistory } from "./ui/history.js";
import { installShortcuts, SHORTCUTS } from "./ui/shortcuts.js";
import { connectToolbar } from "./ui/toolbar.js";
import { installTooltips } from "./ui/tooltips.js";
import { LayersPanel } from "./ui/layers-panel.js";
import { importSvgTree, validateSvgSource } from "./core/svg-import.js";

const byId = (id) => document.getElementById(id);
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
let activeLayerId = currentDocument.layers[0].id;
let nextId = 1;
let activeTool = "select";
let noticeTimer;
let machineConnected = false;
let machineBusy = false;
let statusPollTimer;
const history = new DocumentHistory(currentDocument);

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
  const selected = currentDocument.elements.find((element) => element.id === selectedId);
  inspector.hidden = !selected;
  renderLayers();
  if (!selected) return;

  byId("inspector-kind").textContent = `${selected.type} · ${selected.id}`;
  const isText = selected.type === "text";
  const isPath = selected.type === "path";
  byId("text-inspector-fields").hidden = !isText;
  byId("path-inspector-fields").hidden = !isPath;
  byId("shape-properties").hidden = isText;
  byId("object-text").value = isText ? selected.text : "";
  byId("object-path").value = isPath ? selected.pathData : "";
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
  removeButton.disabled = layerLocked;
}

function renderLayers() {
  layersPanel?.render(currentDocument.layers, currentDocument.elements, activeLayerId);
  updateMachineControls();
}

function selectObject(id) {
  selectedId = id;
  const selected = currentDocument.elements.find((element) => element.id === id);
  if (selected) activeLayerId = selected.layerId;
  syncInspector();
  renderPreview();
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
    const nodes = Array.from(svgDocument.querySelectorAll("[id]"), (node) => {
      const imported = document.importNode(node, true);
      imported.dataset.id = imported.getAttribute("id");
      imported.dataset.layerId = node.closest("[data-layer-id]")?.getAttribute("data-layer-id") ?? "";
      const layer = currentDocument.layers.find((candidate) => candidate.id === imported.dataset.layerId);
      if (layer?.locked) imported.dataset.locked = "true";
      if (imported.dataset.id === selectedId) imported.classList.add("selected");
      return imported;
    });
    objects.replaceChildren(...nodes);
    selectionStatus.textContent = selectedId ? `Selecionado: ${selectedId}` : "Nenhum objeto selecionado";
    const selected = currentDocument.elements.find((element) => element.id === selectedId);
    removeButton.disabled = !selected || currentDocument.layers.find((layer) => layer.id === selected.layerId)?.locked;
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
  selectedId = element.id;
  syncInspector();
  renderPreview();
  commitHistory();
}

function exportSvg() {
  const svg = renderSvg(readDocument());
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "commburn-trabalho.svg";
  link.click();
  URL.revokeObjectURL(url);
  showNotice("SVG exportado com medidas em milímetros.");
}

async function importSvgFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".svg")) throw new Error("Escolha um arquivo com extensão .svg.");
  if (file.size > 10 * 1024 * 1024) throw new RangeError("O SVG deve ter no máximo 10 MB.");
  const layer = currentDocument.layers.find((candidate) => candidate.id === activeLayerId);
  if (!layer || layer.locked) throw new Error("Selecione uma camada desbloqueada para importar objetos.");
  if (!globalThis.svgson?.parseSync) throw new Error("O parser SVG local não foi carregado.");

  const source = await file.text();
  validateSvgSource(source);
  const tree = globalThis.svgson.parseSync(source);
  const imported = importSvgTree(tree, { layerId: activeLayerId, idPrefix: `svg-${nextId}` });
  const elements = [...currentDocument.elements, ...imported.elements];
  currentDocument = createDocument({
    ...currentDocument,
    widthMm: Math.max(currentDocument.widthMm, imported.widthMm),
    heightMm: Math.max(currentDocument.heightMm, imported.heightMm),
    elements
  });
  widthInput.value = currentDocument.widthMm;
  heightInput.value = currentDocument.heightMm;
  nextId += imported.elements.length;
  selectedId = imported.elements.at(-1).id;
  syncInspector();
  renderPreview();
  commitHistory();
  showNotice(`SVG importado: ${imported.elements.length} objeto(s) editável(is), em milímetros.`);
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
  } else if (input.id === "object-path") {
    updateSelected({ pathData: input.value });
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
  if (!selectedId) return;
  const selected = currentDocument.elements.find((element) => element.id === selectedId);
  if (currentDocument.layers.find((layer) => layer.id === selected?.layerId)?.locked) {
    showNotice("Desbloqueie a camada antes de remover objetos.");
    return;
  }
  currentDocument.elements = currentDocument.elements.filter((element) => element.id !== selectedId);
  selectedId = null;
  syncInspector();
  renderPreview();
  commitHistory();
}

function duplicateSelectedObject() {
  try {
    const baseDocument = readDocument();
    const selected = baseDocument.elements.find((element) => element.id === selectedId);
    if (!selected) return;
    if (baseDocument.layers.find((layer) => layer.id === selected.layerId)?.locked) {
      throw new Error("Desbloqueie a camada antes de duplicar objetos.");
    }
    const duplicate = { ...selected, id: `${selected.type}-${nextId++}`, xMm: selected.xMm + 5, yMm: selected.yMm + 5 };
    currentDocument = createDocument({ ...baseDocument, elements: [...baseDocument.elements, duplicate] });
    selectedId = duplicate.id;
    syncInspector();
    renderPreview();
    commitHistory();
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
  if (!currentDocument.elements.some((element) => element.id === selectedId)) selectedId = null;
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
    enabled: true,
    visible: true,
    locked: false,
    color: ["#3978eb", "#e58a2d", "#32a77f", "#9665d8", "#d65d8c", "#5a718f"][layerIndex % 6]
  };
  currentDocument = createDocument({ ...currentDocument, layers: [...currentDocument.layers, layer] });
  activeLayerId = layer.id;
  selectedId = null;
  syncInspector();
  renderPreview();
  commitHistory();
}

const layersPanel = new LayersPanel(byId("layers-list"), {
  onSelect: (layerId) => {
    activeLayerId = layerId;
    selectedId = null;
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
  }
});

byId("add-layer").addEventListener("click", addLayer);
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
  select: selectObject,
  deselect: () => selectObject(null),
  update: (id, patch) => {
    selectedId = id;
    const element = currentDocument.elements.find((candidate) => candidate.id === id);
    if (currentDocument.layers.find((layer) => layer.id === element?.layerId)?.locked) {
      showNotice("A camada está bloqueada. Desbloqueie-a para mover ou transformar este objeto.");
      return;
    }
    updateSelected(patch, false);
  },
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
  addText: () => {
    try { addText(); } catch (error) { showNotice(error.message); }
  },
  help: showShortcuts,
  deselect: () => selectObject(null)
});
byId("shortcut-help").addEventListener("click", showShortcuts);
byId("shortcuts-dialog").querySelector(".dialog-close").addEventListener("click", () => byId("shortcuts-dialog").close());
installTooltips();
new ResizeObserver(() => resizeBoard()).observe(stage);

for (const button of document.querySelectorAll('[data-action="new"]')) button.addEventListener("click", newDocument);
for (const button of document.querySelectorAll('[data-action="import-svg"]')) {
  button.addEventListener("click", () => byId("svg-file-input").click());
}
byId("svg-file-input").addEventListener("change", async (event) => {
  try {
    await importSvgFile(event.target.files[0]);
  } catch (error) {
    showNotice(error.message);
  } finally {
    event.target.value = "";
  }
});
for (const button of document.querySelectorAll('[data-action="export"]')) button.addEventListener("click", () => {
  try { exportSvg(); } catch (error) { showNotice(error.message); }
});
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
