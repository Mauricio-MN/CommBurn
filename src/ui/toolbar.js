export const TOOLS = Object.freeze([
  { id: "select", label: "Selecionar", labelKey: "ui.tools.select.label", descriptionKey: "ui.tools.select.description", key: "V", icon: "↖" },
  { id: "move", label: "Mover", labelKey: "ui.tools.move.label", descriptionKey: "ui.tools.move.description", key: "M", icon: "✥" },
  { id: "size", label: "Tamanho", labelKey: "ui.tools.size.label", descriptionKey: "ui.tools.size.description", key: "S", icon: "⤢" },
  { id: "edit", label: "Editar", labelKey: "ui.tools.edit.label", descriptionKey: "ui.tools.edit.description", key: "E", icon: "✎" },
  { id: "rotate", label: "Rotacionar", labelKey: "ui.tools.rotate.label", descriptionKey: "ui.tools.rotate.description", key: "R", icon: "⟳" },
  { id: "warp", label: "Distorcer", labelKey: "ui.tools.warp.label", descriptionKey: "ui.tools.warp.description", key: "W", icon: "◇" }
]);

export function connectToolbar(root, onChange, { t = (key) => key } = {}) {
  let buttons = [];

  function buildButtons() {
    buttons = TOOLS.map((tool) => {
    const button = document.createElement("button");
    button.className = "tool-button";
    button.type = "button";
    button.dataset.tool = tool.id;
    button.dataset.tooltip = `${t(tool.descriptionKey)} ${t("ui.tools.shortcut", { key: tool.key })}`;
    button.setAttribute("aria-keyshortcuts", tool.key);

    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = tool.icon;
    const label = document.createElement("span");
    label.textContent = t(tool.labelKey);
    const shortcut = document.createElement("kbd");
    shortcut.textContent = tool.key;
    button.append(icon, label, shortcut);
    return button;
    });
    root.replaceChildren(...buttons);
  }

  let activeTool = "select";

  function setTool(toolId) {
    if (!TOOLS.some((tool) => tool.id === toolId)) throw new RangeError(`Unknown tool: ${toolId}`);
    activeTool = toolId;
    for (const button of buttons) {
      const active = button.dataset.tool === activeTool;
      button.setAttribute("aria-pressed", String(active));
      button.classList.toggle("is-active", active);
    }
    root.dataset.activeTool = activeTool;
    onChange(activeTool);
  }

  root.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tool]");
    if (button && root.contains(button)) setTool(button.dataset.tool);
  });

  buildButtons();
  setTool(activeTool);
  return {
    getActiveTool: () => activeTool,
    setTool,
    setTranslator(nextTranslator) {
      t = nextTranslator;
      buildButtons();
      setTool(activeTool);
    },
    tools: TOOLS
  };
}
