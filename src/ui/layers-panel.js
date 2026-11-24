import {
  clearNumberFieldError,
  showNumberFieldError,
  validateNumberField
} from "./field-validation.js";

const OPERATIONS = [
  { value: "engrave", labelKey: "ui.layers.operation.engrave" },
  { value: "cut", labelKey: "ui.layers.operation.cut" },
  { value: "fill", labelKey: "ui.layers.operation.fill" }
];
const FILL_ALGORITHMS = [
  { value: "horizontal-serpentine", labelKey: "ui.layers.algorithm.horizontal" },
  { value: "vertical-serpentine", labelKey: "ui.layers.algorithm.vertical" },
  { value: "crosshatch", labelKey: "ui.layers.algorithm.crosshatch" },
  { value: "horizontal-unidirectional", labelKey: "ui.layers.algorithm.unidirectional" },
  { value: "vertical-unidirectional", labelKey: "ui.layers.algorithm.verticalUnidirectional" },
  { value: "diagonal-serpentine", labelKey: "ui.layers.algorithm.diagonal" },
  { value: "diagonal-crosshatch", labelKey: "ui.layers.algorithm.diagonalCrosshatch" },
  { value: "inset", labelKey: "ui.layers.algorithm.inset" },
  { value: "squares", labelKey: "ui.layers.algorithm.squares" },
  { value: "zigzag", labelKey: "ui.layers.algorithm.zigzag" },
  { value: "hilbert", labelKey: "ui.layers.algorithm.hilbert" }
];
const RASTER_FILL_ALGORITHMS = FILL_ALGORITHMS.filter((value) => ["horizontal-serpentine", "vertical-serpentine", "horizontal-unidirectional", "vertical-unidirectional"].includes(value.value));
const OBJECT_ORDERS = [
  { value: "document", labelKey: "ui.layers.order.document" },
  { value: "nearest", labelKey: "ui.layers.order.nearest" },
  { value: "center-out", labelKey: "ui.layers.order.centerOut" }
];
const FIELD_UNITS = {
  feedMmPerMinute: "mm/min",
  powerPercent: "%",
  fillSpacingMm: "mm"
};

export class LayersPanel {
  constructor(root, { onSelect, onAdd, onUpdate, onDelete, onDuplicate, t = (key) => key }) {
    this.root = root;
    this.t = t;
    this.callbacks = { onSelect, onAdd, onUpdate, onDelete, onDuplicate };
    root.addEventListener("click", (event) => this.handleClick(event));
    root.addEventListener("change", (event) => this.handleChange(event));
    root.addEventListener("input", (event) => this.handleInput(event));
  }

  render(layers, elements, activeLayerId) {
    const t = this.t;
    const list = document.createDocumentFragment();
    for (const layer of layers) {
      const item = document.createElement("article");
      item.className = `layer-card${layer.id === activeLayerId ? " is-active" : ""}`;
      item.dataset.layerId = layer.id;
      item.dataset.locked = String(layer.locked);
      item.style.setProperty("--layer-color", layer.color);

      const header = document.createElement("div");
      header.className = "layer-header";
      const select = document.createElement("button");
      select.className = "layer-select";
      select.type = "button";
      select.dataset.layerSelect = "";
      select.setAttribute("aria-pressed", String(layer.id === activeLayerId));
      select.title = t("ui.layers.selectTooltip");
      const swatch = document.createElement("span");
      swatch.className = "layer-swatch";
      swatch.style.backgroundColor = layer.color;
      const name = document.createElement("span");
      name.textContent = layer.name;
      const count = document.createElement("span");
      count.className = "layer-count";
      count.textContent = String(elements.filter((element) => element.layerId === layer.id).length);
      select.append(swatch, name, count);

      const remove = document.createElement("button");
      remove.className = "layer-remove";
      remove.type = "button";
      remove.dataset.layerDelete = "";
      remove.textContent = "×";
      remove.title = t("ui.layers.removeTooltip");
      remove.setAttribute("aria-label", remove.title);
      remove.disabled = layers.length <= 1;
      const duplicate = document.createElement("button");
      duplicate.className = "layer-duplicate";
      duplicate.type = "button";
      duplicate.dataset.layerDuplicate = "";
      duplicate.textContent = "⧉";
      duplicate.title = t("ui.layers.duplicateTooltip");
      duplicate.setAttribute("aria-label", duplicate.title);
      header.append(select, duplicate, remove);

      const settings = document.createElement("div");
      settings.className = "layer-settings";
      settings.hidden = layer.id !== activeLayerId;
      const layerElements = elements.filter((element) => element.layerId === layer.id);
      const rasterOnly = layerElements.length > 0 && layerElements.every((element) => element.type === "image");
      const summary = document.createElement("p");
      summary.className = "layer-summary";
      summary.textContent = t("ui.layers.summary", {
        operation: t(`ui.layers.operation.${rasterOnly ? "raster" : layer.operation}`),
        power: layer.powerPercent,
        feed: layer.feedMmPerMinute
      });
      const operationSelect = rasterOnly
        ? this.createSelect("operation", "raster", [{ value: "raster", labelKey: "ui.layers.operation.raster" }])
        : this.createSelect("operation", layer.operation, OPERATIONS);
      if (rasterOnly) {
        operationSelect.disabled = true;
        operationSelect.title = t("ui.layers.rasterLocked");
      }
      settings.append(
        this.createGroupHeading("ui.layers.identity"),
        this.createField("ui.layers.operationType", operationSelect),
        this.createField("ui.layers.name", this.createInput("name", layer.name, "text")),
        this.createField("ui.layers.color", this.createInput("color", layer.color, "color")),
        this.createGroupHeading("ui.layers.parameters"),
        this.createField("ui.layers.feed", this.createInput("feedMmPerMinute", layer.feedMmPerMinute, "number", { min: "0.1", step: "0.1" })),
        this.createField("ui.layers.power", this.createInput("powerPercent", layer.powerPercent, "number", { min: "0.1", max: "100", step: "0.1" })),
        this.createField("ui.layers.passes", this.createInput("passes", layer.passes, "number", { min: "1", max: "100", step: "1" }))
      );
      const fillField = this.createField("ui.layers.fillSpacing", this.createInput("fillSpacingMm", layer.fillSpacingMm, "number", { min: "0.05", step: "0.05" }));
      fillField.hidden = layer.operation !== "fill" && !rasterOnly;
      fillField.dataset.fillSetting = "";
      const algorithmField = this.createField("ui.layers.fillAlgorithm", this.createSelect("fillAlgorithm", layer.fillAlgorithm, rasterOnly ? RASTER_FILL_ALGORITHMS : FILL_ALGORITHMS));
      algorithmField.hidden = layer.operation !== "fill" && !rasterOnly;
      algorithmField.dataset.fillSetting = "";
      settings.append(this.createGroupHeading("ui.layers.pathSettings"), fillField, algorithmField);
      settings.append(this.createField("ui.layers.objectOrder", this.createSelect("objectOrder", layer.objectOrder, OBJECT_ORDERS)));

      const switches = document.createElement("div");
      switches.className = "layer-switches";
      switches.append(
        this.createToggle("enabled", "ui.layers.enabled", layer.enabled),
        this.createToggle("visible", "ui.layers.visible", layer.visible),
        this.createToggle("locked", "ui.layers.locked", layer.locked)
      );
      item.append(header, summary, settings, switches);
      list.append(item);
    }
    this.root.replaceChildren(list);
  }

  setTranslator(t) {
    this.t = t;
  }

  createGroupHeading(key) {
    const heading = document.createElement("h3");
    heading.className = "layer-group-heading";
    heading.textContent = this.t(key);
    return heading;
  }

  createField(labelKey, control) {
    const labelText = this.t(labelKey);
    const label = document.createElement("label");
    label.className = "field layer-field";
    label.dataset.property = control.dataset.layerProperty;
    control.title = this.t("ui.layers.fieldDescription", { label: labelText });
    control.setAttribute("aria-description", control.title);
    label.append(document.createTextNode(labelText), control);
    return label;
  }

  createInput(key, value, type, attributes = {}) {
    const input = document.createElement("input");
    input.type = type;
    input.dataset.layerProperty = key;
    if (FIELD_UNITS[key]) input.dataset.unit = FIELD_UNITS[key];
    input.value = value;
    for (const [name, attributeValue] of Object.entries(attributes)) input.setAttribute(name, attributeValue);
    return input;
  }

  createSelect(key, value, options) {
    const select = document.createElement("select");
    select.dataset.layerProperty = key;
    for (const optionData of options) {
      const option = document.createElement("option");
      option.value = optionData.value;
      option.textContent = this.t(optionData.labelKey);
      select.append(option);
    }
    select.value = value;
    return select;
  }

  createToggle(key, labelKey, checked) {
    const labelText = this.t(labelKey);
    const label = document.createElement("label");
    label.className = "layer-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.dataset.layerProperty = key;
    checkbox.title = labelText;
    checkbox.setAttribute("aria-description", labelText);
    const item = document.createElement("span");
    item.textContent = labelText;
    label.append(checkbox, item);
    return label;
  }

  handleClick(event) {
    if (event.target.closest("[data-layer-add]")) {
      this.callbacks.onAdd();
      return;
    }
    const item = event.target.closest("[data-layer-id]");
    if (!item) return;
    if (event.target.closest("[data-layer-delete]")) {
      this.callbacks.onDelete(item.dataset.layerId);
    } else if (event.target.closest("[data-layer-duplicate]")) {
      this.callbacks.onDuplicate(item.dataset.layerId);
    } else if (event.target.closest("[data-layer-select]")) {
      this.callbacks.onSelect(item.dataset.layerId);
    }
  }

  handleChange(event) {
    const input = event.target.closest("[data-layer-property]");
    const item = input?.closest("[data-layer-id]");
    if (!input || !item) return;
    const { layerProperty } = input.dataset;
    let value = input.type === "checkbox" ? input.checked : input.value;
    if (input.type === "number") {
      const result = validateNumberField(input);
      if (!result.valid) {
        showNumberFieldError(input, result, this.t);
        input.focus({ preventScroll: true });
        return;
      }
      clearNumberFieldError(input);
      value = result.value;
    }
    this.callbacks.onUpdate(item.dataset.layerId, { [layerProperty]: value });
  }

  handleInput(event) {
    const input = event.target.closest('[data-layer-property][type="number"]');
    if (!input) return;
    const result = validateNumberField(input);
    if (result.valid) clearNumberFieldError(input);
    else if (input.getAttribute("aria-invalid") === "true") showNumberFieldError(input, result, this.t);
  }
}
