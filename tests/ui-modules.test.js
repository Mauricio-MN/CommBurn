import test from "node:test";
import assert from "node:assert/strict";
import { SHORTCUTS } from "../src/ui/shortcuts.js";
import { TOOLS } from "../src/ui/toolbar.js";
import { loadDesktopPlugins } from "../src/ui/plugins.js";
import { createI18n } from "../src/core/i18n.js";
import { planGrblJob } from "../src/core/document.js";
import {
  createPresentationDocument,
  createPresentationSimulationDocument
} from "../src/ui/presentation.js";

test("each editor tool has one documented and keyboard-accessible shortcut", () => {
  assert.equal(TOOLS.some(({ id }) => id === "multi-select"), false);
  for (const tool of TOOLS) {
    assert.ok(SHORTCUTS.some((shortcut) => shortcut.keys === tool.key), `${tool.label} must be listed in shortcuts`);
    assert.ok(tool.descriptionKey && tool.labelKey, `${tool.label} must provide translation keys`);
  }
  assert.equal(new Set(TOOLS.map((tool) => tool.key)).size, TOOLS.length);
});

test("copy and paste shortcuts are documented for cross-layer object transfer", () => {
  assert.ok(SHORTCUTS.some(({ keys }) => keys === "Ctrl+C"));
  assert.ok(SHORTCUTS.some(({ keys }) => keys === "Ctrl+V"));
});

test("presentation simulation includes editable text and keeps only untransformed GRBL geometry", () => {
  const source = createPresentationDocument();
  const documentModel = {
    ...source,
    elements: [
      { id: "label", type: "text", text: "CommBurn", xMm: 10, yMm: 20, fontSizeMm: 8, layerId: source.layers[0].id },
      { id: "frame", type: "rect", xMm: 20, yMm: 20, widthMm: 80, heightMm: 40, layerId: source.layers[0].id },
      { id: "rotated", type: "rect", xMm: 25, yMm: 25, widthMm: 5, heightMm: 5, rotationDeg: 20, layerId: source.layers[0].id }
    ]
  };

  const simulationDocument = createPresentationSimulationDocument(documentModel);
  const plan = planGrblJob(simulationDocument, { maxSpindleSpeed: 1000 });

  assert.deepEqual(simulationDocument.elements.map(({ id }) => id), ["label", "frame"]);
  assert.ok(plan.paths.some(({ elementId, kind }) => elementId === "label" && kind === "work"));
  assert.ok(plan.paths.some(({ kind }) => kind === "work"));
  assert.ok(plan.gcode.includes("G1"));
});

test("presentation starts with an empty metric document and a safe unlocked demo layer", () => {
  const documentModel = createPresentationDocument();

  assert.equal(documentModel.widthMm, 180);
  assert.equal(documentModel.heightMm, 120);
  assert.deepEqual(documentModel.elements, []);
  assert.equal(documentModel.layers[0].operation, "engrave");
  assert.equal(documentModel.layers[0].locked, false);
});

test("desktop plugins register UI elements in named extension slots", async () => {
  const element = { nodeType: 1, dataset: {}, remove() {} };
  const mounted = [];
  let context;
  const result = await loadDesktopPlugins({
    fetchImpl: async (url) => {
      assert.equal(url, "/api/plugins");
      return {
        ok: true,
        json: async () => ({ plugins: [{
          id: "demo-plugin",
          name: "Demo",
          version: "1.0.0",
          apiVersion: 1,
          url: "/desktop-plugins/demo-plugin/plugin.mjs"
        }] })
      };
    },
    documentRef: {
      querySelector: (selector) => selector === '[data-extension-slot="canvas-header"]'
        ? { append: (child) => mounted.push(child) }
        : null
    },
    importModule: async (url) => {
      assert.equal(url, "/desktop-plugins/demo-plugin/plugin.mjs");
      return { activate: (pluginContext) => {
        context = pluginContext;
        pluginContext.registerExtension("canvas-header", element);
      } };
    },
    documentApi: { get: () => ({ widthMm: 10 }) }
  });

  assert.deepEqual(result.loaded, [{ id: "demo-plugin", name: "Demo", version: "1.0.0" }]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(mounted, [element]);
  assert.equal(element.dataset.pluginId, "demo-plugin");
  assert.equal(context.apiVersion, 1);
  assert.deepEqual(context.document.get(), { widthMm: 10 });
});

test("desktop plugins receive their own translations and follow the active locale", async () => {
  const coreI18n = createI18n({
    locale: "en",
    catalogs: { en: { common: {} }, "pt-BR": { common: {} } },
    fallbackLocale: "en"
  });
  let context;
  const observedLocales = [];
  const plugin = {
    id: "localized-plugin",
    name: "Localized",
    version: "1.0.0",
    apiVersion: 1,
    url: "/desktop-plugins/localized-plugin/plugin.mjs",
    localeUrls: {
      en: "/desktop-plugins/localized-plugin/locales/en.json",
      "pt-BR": "/desktop-plugins/localized-plugin/locales/pt-BR.json"
    }
  };
  const response = (body) => ({ ok: true, json: async () => body });
  await loadDesktopPlugins({
    i18n: coreI18n,
    documentRef: { querySelector: () => null },
    fetchImpl: async (url) => {
      if (url === "/api/plugins") return response({ plugins: [plugin] });
      if (url === plugin.localeUrls.en) return response({ greeting: "Hello", fallback: "English fallback" });
      if (url === plugin.localeUrls["pt-BR"]) return response({ greeting: "Olá" });
      throw new Error(`Unexpected URL: ${url}`);
    },
    importModule: async () => ({ activate: (pluginContext) => {
      context = pluginContext;
      observedLocales.push(pluginContext.i18n.locale, pluginContext.i18n.t("greeting"));
      pluginContext.i18n.onLocaleChange((locale) => observedLocales.push(locale, pluginContext.i18n.t("greeting")));
    } })
  });

  coreI18n.setLocale("pt-BR");
  assert.deepEqual(observedLocales, ["en", "Hello", "pt-BR", "Olá"]);
  assert.equal(context.i18n.locale, "pt-BR");
  assert.equal(context.i18n.t("fallback"), "English fallback");
  let notifications = 0;
  const unsubscribe = context.i18n.onLocaleChange(() => { notifications += 1; });
  unsubscribe();
  coreI18n.setLocale("en");
  assert.equal(notifications, 0);
});

test("desktop plugin activation errors are isolated and reported", async () => {
  const result = await loadDesktopPlugins({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ plugins: [{
        id: "broken-plugin",
        name: "Broken",
        version: "1.0.0",
        apiVersion: 1,
        url: "/desktop-plugins/broken-plugin/plugin.mjs"
      }] })
    }),
    documentRef: { querySelector: () => null },
    importModule: async () => ({ activate: ({ registerExtension }) => {
      registerExtension("unknown-slot", { nodeType: 1, dataset: {}, remove() {} });
    } })
  });

  assert.deepEqual(result.loaded, []);
  assert.equal(result.errors[0].id, "broken-plugin");
  assert.match(result.errors[0].message, /desconhecido/);
});
