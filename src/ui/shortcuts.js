import { TOOLS } from "./toolbar.js";

const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable='true']";

export const SHORTCUTS = Object.freeze([
  ...TOOLS.map(({ id, key }) => ({ keys: key, translationKey: "ui.shortcuts.tool", toolId: id })),
  { keys: "Ctrl+Enter", translationKey: "ui.shortcuts.addText" },
  { keys: "Ctrl+C", translationKey: "ui.shortcuts.copy" },
  { keys: "Ctrl+V", translationKey: "ui.shortcuts.paste" },
  { keys: "Delete", translationKey: "ui.shortcuts.remove" },
  { keys: "Ctrl+D", translationKey: "ui.shortcuts.duplicate" },
  { keys: "Ctrl+Z", translationKey: "ui.shortcuts.undo" },
  { keys: "Ctrl+Y", translationKey: "ui.shortcuts.redo" },
  { keys: "Ctrl+S", translationKey: "ui.shortcuts.export" },
  { keys: "?", translationKey: "ui.shortcuts.help" }
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
