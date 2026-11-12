const STYLE_ID = "editor-theme-style";
const STORAGE_KEY = "commburn.editorTheme";

const CSS = `
:root.editor-theme { color-scheme: dark; color: #d4d4d4; background: #1e1e1e; --muted: #9da5b4; --line: #3c3c3c; --shadow: 0 8px 24px rgb(0 0 0 / 45%); }
.editor-theme body, .editor-theme .workspace, .editor-theme .canvas-area { background: #1e1e1e; }
.editor-theme .topbar, .editor-theme .canvas-toolbar, .editor-theme .statusbar, .editor-theme .menu-popover, .editor-theme .panel, .editor-theme .tool-button, .editor-theme .button-secondary, .editor-theme .field input, .editor-theme .field textarea, .editor-theme .field select, .editor-theme .locale-control select, .editor-theme dialog { background: #252526; color: #cccccc; border-color: #3c3c3c; }
.editor-theme .sidebar { background: #252526; border-right-color: #3c3c3c; }
.editor-theme .menu[open] summary, .editor-theme .menu summary:hover, .editor-theme .menu-popover button:hover, .editor-theme .tool-button:hover, .editor-theme .tool-button.is-active { background: #2a2d2e; color: #ffffff; border-color: #007acc; }
.editor-theme .unit-pill, .editor-theme .saved-badge, .editor-theme .layer-count, .editor-theme kbd { background: #333333; color: #aaaaaa; border-color: #444444; }
.editor-theme .layer-card, .editor-theme .layer-card.is-active { background: #2d2d30; border-color: #3c3c3c; color: #cccccc; }
.editor-theme .layer-card.is-active { background: #094771; }
.editor-theme .button-primary { background: #0e639c; color: #ffffff; border-color: #0e639c; }
.editor-theme .button-primary:hover { background: #1177bb; }
.editor-theme .button-danger { background: #252526; color: #f48771; border-color: #5a2a2a; }
.editor-theme .field input, .editor-theme .field textarea, .editor-theme .field select, .editor-theme .locale-control select { color: #cccccc; background: #3c3c3c; border-color: #505050; }
.editor-theme .document-name, .editor-theme .canvas-actions, .editor-theme .project-name { color: #cccccc; }
.editor-theme .project-name:hover, .editor-theme .project-name:focus { background: #2a2d2e; border-color: #007acc; }
.editor-theme dialog { box-shadow: 0 18px 60px rgb(0 0 0 / 60%); }
`;

function readEnabled() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function writeEnabled(enabled) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Storage may be unavailable; the toggle still works for this session.
  }
}

export function activate(context) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-secondary";
  button.textContent = "Tema editor";

  let enabled = false;
  const apply = (next) => {
    enabled = next;
    document.documentElement.classList.toggle("editor-theme", enabled);
    button.setAttribute("aria-pressed", String(enabled));
    writeEnabled(enabled);
  };
  button.addEventListener("click", () => apply(!enabled));
  apply(readEnabled());

  const removeButton = context.registerExtension("toolbar-tools", button);

  return () => {
    document.documentElement.classList.remove("editor-theme");
    removeButton();
    document.getElementById(STYLE_ID)?.remove();
  };
}
