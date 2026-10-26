export const TOOLS = Object.freeze([
  { id: "select", label: "Selecionar", key: "V", icon: "↖", description: "Seleciona objetos sem movê-los." },
  { id: "move", label: "Mover", key: "M", icon: "✥", description: "Arraste um objeto para reposicioná-lo em milímetros." },
  { id: "edit", label: "Editar", key: "E", icon: "✎", description: "Selecione um objeto e edite suas propriedades numéricas." },
  { id: "rotate", label: "Rotacionar", key: "R", icon: "⟳", description: "Arraste ao redor do objeto para definir seu ângulo." },
  { id: "warp", label: "Distorcer", key: "W", icon: "◇", description: "Arraste para distorcer; os campos permitem ajuste preciso." }
]);

export function connectToolbar(root, onChange) {
  const buttons = TOOLS.map((tool) => {
    const button = document.createElement("button");
    button.className = "tool-button";
    button.type = "button";
    button.dataset.tool = tool.id;
    button.dataset.tooltip = `${tool.description} Atalho ${tool.key}.`;
    button.setAttribute("aria-keyshortcuts", tool.key);

    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = tool.icon;
    const label = document.createElement("span");
    label.textContent = tool.label;
    const shortcut = document.createElement("kbd");
    shortcut.textContent = tool.key;
    button.append(icon, label, shortcut);
    return button;
  });
  root.replaceChildren(...buttons);
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

  setTool(activeTool);
  return { getActiveTool: () => activeTool, setTool, tools: TOOLS };
}
