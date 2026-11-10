# CommBurn project guidelines

CommBurn is a beginner-friendly, metric-first vector editor for laser work. Keep the interface direct, visible, and consistent; do not reproduce legacy editor conventions or hide essential actions.

- Treat millimetres as the canonical unit in the model, UI, CLI, and exports. Validate dimensions and positions as finite metric values.
- Keep coordinate origin and axis direction explicitly user-controlled. Never infer them from machine sensors.
- Keep the document core independent of the browser so the same operations can be used by the UI, CLI, AI tools, and plugins.
- The CommBurn core is AGPL-3.0-only from v0.1.2; independent plugins may retain permissive licenses such as MIT (see LICENSE-PLUGINS), without relicensing the core.
- Prefer accessible native HTML controls, clear labels, and focused workflows suitable for first-time users.
- Keep user-facing strings in locale catalogs; use stable error codes and parameters, not mixed-language messages. Follow [the internationalization plan](../docs/INTERNATIONALIZATION_PLAN.md) and do not assume plugin i18n APIs exist until implemented.
- Keep editor features in focused ES modules and follow the named UI extension slots; packaged desktop builds may load trusted local plugins only, never remote plugin code.
- Preserve SVG viewBox aspect ratio and keep rulers aligned to the actual drawing bounds.
- Use the built-in Node test runner (`npm test`) for core and CLI changes. The project has no build step.

See [the project guide](../docs/PROJECT_GUIDE.md) for scope, architecture, and the staged roadmap.
