const STYLE_ID = "editor-theme-style";

const CSS = `
:root { color-scheme: dark; color: #d4d4d4; background: #1e1e1e; --muted: #9da5b4; --line: #3c3c3c; --shadow: 0 8px 24px rgb(0 0 0 / 45%); }
body, .workspace, .canvas-area { background: #1e1e1e; }
.topbar, .canvas-toolbar, .statusbar, .menu-popover, .panel, .tool-button, .button-secondary, .field input, .field textarea, .field select, .locale-control select, dialog { background: #252526; color: #cccccc; border-color: #3c3c3c; }
.sidebar { background: #252526; border-right-color: #3c3c3c; }
.menu[open] summary, .menu summary:hover, .menu-popover button:hover, .tool-button:hover, .tool-button.is-active { background: #2a2d2e; color: #ffffff; border-color: #007acc; }
.unit-pill, .saved-badge, .layer-count, kbd { background: #333333; color: #aaaaaa; border-color: #444444; }
.layer-card, .layer-card.is-active { background: #2d2d30; border-color: #3c3c3c; color: #cccccc; }
.layer-card.is-active { background: #094771; }
.button-primary { background: #0e639c; color: #ffffff; border-color: #0e639c; }
.button-primary:hover { background: #1177bb; }
.button-danger { background: #252526; color: #f48771; border-color: #5a2a2a; }
.field input, .field textarea, .field select, .locale-control select { color: #cccccc; background: #3c3c3c; border-color: #505050; }
.document-name, .canvas-actions, .project-name { color: #cccccc; }
.project-name:hover, .project-name:focus { background: #2a2d2e; border-color: #007acc; }
dialog { box-shadow: 0 18px 60px rgb(0 0 0 / 60%); }
`;

export function activate() {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);

  return () => {
    document.getElementById(STYLE_ID)?.remove();
  };
}
