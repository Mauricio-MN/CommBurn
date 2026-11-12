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

## Non-negotiable compatibility rules

- TABU: never remove, rename, reinterpret, round, rasterize, or silently discard data from an editable project to make a load or conversion succeed.
- TABU: every persisted project schema change requires a format version increment, explicit one-version-at-a-time conversions, and regression fixtures for all supported older versions.
- TABU: conversions must prove model and visual preservation in tests (`createDocument` equality and `renderSvg` equality where representable); reject unsupported data explicitly instead of claiming a faithful conversion.
- Never overwrite a user's original file during migration; conversion happens in memory and saving is an explicit user action.
- Treat `svg-image` as a visual reference, not editable vector geometry. Preserve it; do not send it through raster tracing as an implicit substitute for native SVG import.

Follow [the editable project format contract](../docs/PROJECT_FORMAT.md) for schema versions, migrations, and required tests.

See [the project guide](../docs/PROJECT_GUIDE.md) for scope, architecture, and the staged roadmap.
