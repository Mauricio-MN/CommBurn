import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHORTCUTS } from "../src/ui/shortcuts.js";
import { TOOLS } from "../src/ui/toolbar.js";
import { loadDesktopPlugins } from "../src/ui/plugins.js";
import { LayersPanel } from "../src/ui/layers-panel.js";
import { getInspectorSections } from "../src/ui/inspector-state.js";
import { createI18n } from "../src/core/i18n.js";
import { planGrblJob } from "../src/core/document.js";
import {
  clearNumberFieldError,
  numberFieldErrorMessage,
  showNumberFieldError,
  validateNumberField
} from "../src/ui/field-validation.js";
import enCatalog from "../src/locales/en.js";
import ptBrCatalog from "../src/locales/pt-BR.js";
import {
  createPresentationDocument,
  createPresentationSimulationDocument,
  PRESENTATION_STEPS
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

test("guided presentation drives real fields through typed and clicked sub-steps", () => {
  assert.deepEqual(PRESENTATION_STEPS.map(({ key }) => key), [
    "workspace", "text", "frame", "detail", "inspect", "preview", "simulate"
  ]);
  assert.equal(new Set(PRESENTATION_STEPS.map(({ key }) => key)).size, PRESENTATION_STEPS.length);
  const kinds = new Set(["type", "choose", "click", "simulate"]);
  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const catalog of [enCatalog, ptBrCatalog]) {
    for (const kind of ["type", "choose", "click", "simulate"]) {
      assert.equal(typeof catalog.ui.presentation.substeps[kind], "string", `locale must define substeps.${kind}`);
    }
  }
  assert.ok(indexHtml.includes('src="/mouse-cursor-presentation.svg"'));
});

test("numeric field validation distinguishes parse, bounds, and step errors", () => {
  const field = (value, attributes = {}) => ({
    value,
    min: attributes.min ?? "",
    max: attributes.max ?? "",
    step: attributes.step ?? "",
    validity: attributes.validity ?? {}
  });

  assert.deepEqual(validateNumberField(field(" ")), { valid: false, code: "required" });
  assert.deepEqual(validateNumberField(field("NaN")), { valid: false, code: "invalid" });
  assert.deepEqual(validateNumberField(field("Infinity")), { valid: false, code: "invalid" });
  assert.deepEqual(validateNumberField(field("0", { min: "0.1" })), {
    valid: false, code: "minimum", minimum: 0.1
  });
  assert.deepEqual(validateNumberField(field("101", { max: "100" })), {
    valid: false, code: "maximum", maximum: 100
  });
  assert.deepEqual(validateNumberField(field("1.2", {
    step: "1", validity: { stepMismatch: true }
  })), { valid: false, code: "step", step: 1 });
  assert.deepEqual(validateNumberField(field("1.5", { min: "0.1", max: "10" })), {
    valid: true, value: 1.5
  });
});

test("numeric errors name the correct field and clear only its inline state", () => {
  const i18n = createI18n({ locale: "en", catalogs: { en: enCatalog }, fallbackLocale: "en" });
  const makeInput = (label) => {
    const children = [];
    const attributes = new Map();
    const field = {
      firstChild: { textContent: label },
      append(child) { children.push(child); },
      querySelector(selector) { return children.find((child) => `#${child.id}` === selector) ?? null; }
    };
    return {
      children,
      attributes,
      dataset: { unit: "mm" },
      closest(selector) { return selector === "label" ? field : null; },
      getAttribute(name) { return attributes.get(name) ?? null; },
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); },
      setCustomValidity(value) { this.customValidity = value; },
      field
    };
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return { setAttribute(name, value) { this[name] = value; }, remove() { this.removed = true; } };
    }
  };
  const width = makeInput("Width");
  const height = makeInput("Height");
  const result = { valid: false, code: "maximum", maximum: 50 };
  try {
    assert.equal(numberFieldErrorMessage(width, result, i18n.t), "Width must be at most 50 mm.");
    showNumberFieldError(width, result, i18n.t);
    showNumberFieldError(height, result, i18n.t);
    assert.equal(width.attributes.get("aria-invalid"), "true");
    assert.match(width.attributes.get("aria-describedby"), /number-field-error-/);
    assert.equal(width.children[0].textContent, "Width must be at most 50 mm.");
    clearNumberFieldError(width);
    assert.equal(width.attributes.has("aria-invalid"), false);
    assert.equal(width.attributes.has("aria-describedby"), false);
    assert.equal(width.customValidity, "");
    assert.equal(height.attributes.get("aria-invalid"), "true");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("layer panel keeps invalid values local and updates only after correction", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return { setAttribute(name, value) { this[name] = value; }, remove() { this.removed = true; } };
    }
  };
  const children = [];
  const attributes = new Map();
  const fieldLabel = {
    firstChild: { textContent: "Feed rate" },
    append(child) { children.push(child); },
    querySelector(selector) { return children.find((child) => `#${child.id}` === selector) ?? null; }
  };
  const layerItem = { dataset: { layerId: "engrave" } };
  let updates = 0;
  const panel = new LayersPanel({ addEventListener() {} }, {
    onUpdate() { updates += 1; },
    t: (key, values) => `${values.label} ${values.minimum}${values.unit}`
  });
  const input = {
    type: "number",
    value: "0.5",
    min: "1",
    max: "",
    step: "1",
    validity: { rangeUnderflow: true },
    dataset: { layerProperty: "feedMmPerMinute", unit: "mm/min" },
    closest(selector) {
      if (selector === "[data-layer-property]") return this;
      if (selector === "[data-layer-id]") return layerItem;
      if (selector === "label") return fieldLabel;
      return null;
    },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    setCustomValidity(value) { this.customValidity = value; },
    focus() { this.focused = true; }
  };

  try {
    panel.handleChange({ target: input });
    assert.equal(updates, 0);
    assert.equal(input.focused, true);
    assert.equal(attributes.get("aria-invalid"), "true");
    assert.equal(children[0].textContent, "Feed rate 1 mm/min");

    input.value = "300";
    input.validity = {};
    panel.handleChange({ target: input });
    assert.equal(updates, 1);
    assert.equal(attributes.has("aria-invalid"), false);
    assert.equal(input.customValidity, "");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("inspector identifies visual SVG objects without confusing raster images", () => {
  assert.deepEqual(getInspectorSections({ type: "svg-image" }), {
    isText: false,
    isPath: false,
    isImage: false,
    isSvgImage: true
  });
  assert.equal(getInspectorSections({ type: "image" }).isSvgImage, false);
  assert.equal(getInspectorSections(null).isSvgImage, false);
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
