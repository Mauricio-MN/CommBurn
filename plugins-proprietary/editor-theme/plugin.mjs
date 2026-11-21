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
.editor-theme .document-tabs { background: #252526; border-color: #3c3c3c; }
.editor-theme .document-tab { background: #2d2d30; color: #9da5b4; border-color: #3c3c3c; }
.editor-theme .document-tab.is-active { background: #1e1e1e; color: #ffffff; border-bottom-color: #007acc; }
.editor-theme .document-tab:hover { background: #2a2d2e; color: #ffffff; }
.editor-theme .saved-badge[data-saved-state="unsaved"] { color: #cca700; border-color: #5c4d00; }
.editor-theme .saved-badge[data-saved-state="saved"] { color: #89d185; border-color: #2d5a2d; }
.editor-theme .menu-popover button, .editor-theme .menu summary, .editor-theme .brand, .editor-theme .menu-group-label { color: #cccccc; }
.editor-theme .menu-group-label { color: #9da5b4; }
.editor-theme .menu-popover button:hover { background: #094771; color: #ffffff; }
.editor-theme .brand, .editor-theme .panel-heading h1, .editor-theme .panel-heading h2 { color: #ffffff; }
.editor-theme .panel-heading p, .editor-theme .help-text, .editor-theme .tool-status, .editor-theme .stage-note, .editor-theme .unit-note, .editor-theme .field, .editor-theme .toggle, .editor-theme .input-with-unit span, .editor-theme .machine-state { color: #9da5b4; }
.editor-theme .canvas-area, .editor-theme .stage { background-color: #1e1e1e; }
.editor-theme .artboard { border-color: #3c3c3c; }
.editor-theme .ruler { color: #9da5b4; }
.editor-theme .document-tab-select, .editor-theme .document-tab-close, .editor-theme .document-tab-add { color: #cccccc; background: transparent; }
.editor-theme .document-tab-add:hover, .editor-theme .document-tab-close:hover { color: #ffffff; }
.editor-theme .context-menu, .editor-theme .context-submenu-list, .editor-theme .notice, .editor-theme .notice-log { background: #252526; color: #cccccc; border-color: #3c3c3c; }
.editor-theme .context-menu-item, .editor-theme .context-menu-danger { color: #cccccc; }
.editor-theme .context-menu-item:hover, .editor-theme .context-menu-item:focus-visible { background: #094771; color: #ffffff; }
.editor-theme .notice-log-header { color: #cccccc; }
.editor-theme .notice-log textarea { color: #cccccc; background: #1e1e1e; border-color: #3c3c3c; }
.editor-theme .origin-dot { background: #252526; border-color: #505050; }
.editor-theme .toggle-track { background: #3c3c3c; }
.editor-theme .machine-warning { color: #e6c27a; background: #3a2e1a; border-color: #5c4a24; }
.editor-theme .statusbar, .editor-theme .canvas-toolbar { color: #9da5b4; }
.editor-theme .button-secondary:hover, .editor-theme .button-secondary:disabled { background: #2a2d2e; }
.editor-theme .button-secondary:disabled { color: #6c6c6c; }
.editor-theme .layer-select, .editor-theme .layer-toggle, .editor-theme .layer-duplicate, .editor-theme .layer-remove { color: #cccccc; background: transparent; }
.editor-theme .layer-duplicate, .editor-theme .layer-remove, .editor-theme .layer-duplicate:hover { background: #2d2d30; }
.editor-theme dialog p, .editor-theme dialog h1, .editor-theme dialog h2 { color: #cccccc; }
.editor-theme .quick-properties { background: #252526; border-color: #3c3c3c; color: #9da5b4; box-shadow: var(--shadow); }
.editor-theme .quick-properties summary { color: #cccccc; }
.editor-theme .quick-row input, .editor-theme .quick-row select { color: #cccccc; background: #3c3c3c; border-color: #505050; }
.editor-theme .section-icon { background: #2d2d30; }
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
  button.textContent = "Tema Escuro";

  let enabled = false;
  const apply = (next) => {
    enabled = next;
    document.documentElement.classList.toggle("editor-theme", enabled);
    button.setAttribute("aria-pressed", String(enabled));
    writeEnabled(enabled);
  };
  button.addEventListener("click", () => apply(!enabled));
  apply(readEnabled());

  const removeButton = context.registerExtension("menu-bar", button);

  return () => {
    document.documentElement.classList.remove("editor-theme");
    removeButton();
    document.getElementById(STYLE_ID)?.remove();
  };
}
