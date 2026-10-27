const OPERATIONS = [
  { value: "engrave", label: "Gravação" },
  { value: "cut", label: "Corte" },
  { value: "fill", label: "Preenchimento" }
];

export class LayersPanel {
  constructor(root, { onSelect, onAdd, onUpdate, onDelete, onDuplicate }) {
    this.root = root;
    this.callbacks = { onSelect, onAdd, onUpdate, onDelete, onDuplicate };
    root.addEventListener("click", (event) => this.handleClick(event));
    root.addEventListener("change", (event) => this.handleChange(event));
  }

  render(layers, elements, activeLayerId) {
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
      select.title = "Selecionar camada para criar novos objetos";
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
      remove.title = "Remover camada e mover seus objetos para outra camada";
      remove.setAttribute("aria-label", remove.title);
      remove.disabled = layers.length <= 1;
      const duplicate = document.createElement("button");
      duplicate.className = "layer-duplicate";
      duplicate.type = "button";
      duplicate.dataset.layerDuplicate = "";
      duplicate.textContent = "⧉";
      duplicate.title = "Duplicar camada e seus objetos";
      duplicate.setAttribute("aria-label", duplicate.title);
      header.append(select, duplicate, remove);

      const settings = document.createElement("div");
      settings.className = "layer-settings";
      settings.append(
        this.createField("Tipo de operação", this.createSelect("operation", layer.operation, OPERATIONS)),
        this.createField("Nome", this.createInput("name", layer.name, "text")),
        this.createField("Cor de visualização", this.createInput("color", layer.color, "color")),
        this.createField("Avanço (mm/min)", this.createInput("feedMmPerMinute", layer.feedMmPerMinute, "number", { min: "0.1", step: "10" })),
        this.createField("Potência (%)", this.createInput("powerPercent", layer.powerPercent, "number", { min: "0.1", max: "100", step: "1" })),
        this.createField("Passes", this.createInput("passes", layer.passes, "number", { min: "1", max: "100", step: "1" }))
      );
      const fillField = this.createField("Espaçamento do preenchimento (mm)", this.createInput("fillSpacingMm", layer.fillSpacingMm, "number", { min: "0.1", step: "0.1" }));
      fillField.hidden = layer.operation !== "fill";
      fillField.dataset.fillSetting = "";
      settings.append(fillField);

      const switches = document.createElement("div");
      switches.className = "layer-switches";
      switches.append(
        this.createToggle("enabled", "Incluir no envio", layer.enabled),
        this.createToggle("visible", "Visível no desenho", layer.visible),
        this.createToggle("locked", "Bloquear edição", layer.locked)
      );
      item.append(header, settings, switches);
      list.append(item);
    }
    this.root.replaceChildren(list);
  }

  createField(labelText, control) {
    const label = document.createElement("label");
    label.className = "field layer-field";
    control.title = `${labelText} da camada`;
    control.setAttribute("aria-description", control.title);
    label.append(document.createTextNode(labelText), control);
    return label;
  }

  createInput(key, value, type, attributes = {}) {
    const input = document.createElement("input");
    input.type = type;
    input.dataset.layerProperty = key;
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
      option.textContent = optionData.label;
      select.append(option);
    }
    select.value = value;
    return select;
  }

  createToggle(key, labelText, checked) {
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
    let value = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
    if (input.type === "number" && (!Number.isFinite(value) || !input.checkValidity())) {
      input.reportValidity();
      return;
    }
    this.callbacks.onUpdate(item.dataset.layerId, { [layerProperty]: value });
  }
}
