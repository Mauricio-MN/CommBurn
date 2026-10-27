import { TOOLS } from "./toolbar.js";

const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable='true']";

export const SHORTCUTS = Object.freeze([
  ...TOOLS.map(({ key, label }) => ({ keys: key, description: `${label} ferramenta` })),
  { keys: "Ctrl+Enter", description: "Adicionar texto" },
  { keys: "Ctrl+C", description: "Copiar objeto(s) selecionado(s)" },
  { keys: "Ctrl+V", description: "Colar na camada ativa" },
  { keys: "Delete", description: "Remover objeto(s) selecionado(s)" },
  { keys: "Ctrl+D", description: "Duplicar objeto(s) selecionado(s)" },
  { keys: "Ctrl+Z", description: "Desfazer" },
  { keys: "Ctrl+Y", description: "Refazer" },
  { keys: "Ctrl+S", description: "Exportar SVG" },
  { keys: "?", description: "Mostrar atalhos" }
]);

export function installShortcuts(actions) {
  const toolsByKey = new Map(TOOLS.map((tool) => [tool.key.toLowerCase(), tool.id]));

  function handleKeydown(event) {
    if (event.defaultPrevented || event.altKey || event.metaKey && event.ctrlKey) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      actions.addText();
      event.preventDefault();
      return;
    }
    if (event.target instanceof Element && (event.target.closest(EDITABLE_SELECTOR) || event.target.closest("dialog[open]"))) return;

    const key = event.key.toLowerCase();
    const tool = toolsByKey.get(key);
    if (tool && !event.ctrlKey && !event.metaKey) {
      actions.setTool(tool);
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === "z") {
      (event.shiftKey ? actions.redo : actions.undo)();
      event.preventDefault();
    } else if ((event.ctrlKey || event.metaKey) && key === "c") {
      actions.copy();
      event.preventDefault();
    } else if ((event.ctrlKey || event.metaKey) && key === "v") {
      actions.paste();
      event.preventDefault();
    } else if ((event.ctrlKey || event.metaKey) && key === "y") {
      actions.redo();
      event.preventDefault();
    } else if ((event.ctrlKey || event.metaKey) && key === "s") {
      actions.export();
      event.preventDefault();
    } else if ((event.ctrlKey || event.metaKey) && key === "d") {
      actions.duplicate();
      event.preventDefault();
    } else if (key === "delete" || key === "backspace") {
      actions.remove();
      event.preventDefault();
    } else if (event.key === "?") {
      actions.help();
      event.preventDefault();
    } else if (event.key === "Escape") {
      actions.setTool("select");
      actions.deselect();
      event.preventDefault();
    }
  }

  document.addEventListener("keydown", handleKeydown);
  return () => document.removeEventListener("keydown", handleKeydown);
}
