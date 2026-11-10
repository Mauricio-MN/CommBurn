import test from "node:test";
import assert from "node:assert/strict";
import { CommBurnError, createI18n, normalizeLocale, resolveLocale } from "../src/core/i18n.js";
import en from "../src/locales/en.js";
import ptBR from "../src/locales/pt-BR.js";

const catalogs = { en, "pt-BR": ptBR };

function keys(value, prefix = "") {
  return Object.entries(value).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return item && typeof item === "object" && !Array.isArray(item)
      ? keys(item, path)
      : [path];
  });
}

test("locale normalization supports English and Brazilian Portuguese aliases", () => {
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("pt"), "pt-BR");
  assert.equal(normalizeLocale("pt-PT"), "pt-BR");
  assert.equal(normalizeLocale("fr-FR"), null);
  assert.equal(resolveLocale(["fr-FR", "en-GB"]), "en");
  assert.equal(resolveLocale("fr-FR"), "pt-BR");
});

test("English and Portuguese catalogs have matching keys", () => {
  assert.deepEqual(keys(en).sort(), keys(ptBR).sort());
});

test("translations interpolate values and select locale-aware plurals", () => {
  const i18n = createI18n({ locale: "en", catalogs, fallbackLocale: "en" });
  assert.equal(i18n.t("errors.document.duplicateId", { id: "shape-2" }), "Duplicate object ID: shape-2.");
  assert.equal(i18n.t("common.items", { count: 1 }), "1 item");
  assert.equal(i18n.t("common.items", { count: 3 }), "3 items");
  i18n.setLocale("pt-BR");
  assert.equal(i18n.t("common.items", { count: 1 }), "1 item");
  assert.equal(i18n.t("common.items", { count: 3 }), "3 itens");
});

test("locale changes notify listeners and can be unsubscribed", () => {
  const i18n = createI18n({ locale: "en", catalogs, fallbackLocale: "en" });
  const changes = [];
  const unsubscribe = i18n.onLocaleChange((locale, previous) => changes.push([locale, previous]));
  i18n.setLocale("pt");
  unsubscribe();
  i18n.setLocale("en");
  assert.deepEqual(changes, [["pt-BR", "en"]]);
});

test("coded errors are formatted without coupling the core to a UI", () => {
  const error = new CommBurnError("document.duplicateId", { id: "shape-2" });
  const i18n = createI18n({ locale: "pt-BR", catalogs, fallbackLocale: "en" });
  assert.equal(error.code, "document.duplicateId");
  assert.equal(i18n.formatError(error), "ID de objeto duplicado: shape-2.");
  assert.equal(i18n.formatError(new TypeError("untranslated dependency text")), "Ocorreu um erro inesperado.");
});

test("missing translation keys use the fallback catalog and report missing keys", () => {
  const missing = [];
  const partial = { en: { common: { present: "Present" } }, "pt-BR": { common: {} } };
  const i18n = createI18n({ locale: "pt-BR", catalogs: partial, fallbackLocale: "en", onMissing: (event) => missing.push(event) });
  assert.equal(i18n.t("common.present"), "Present");
  assert.equal(i18n.t("common.absent"), "common.absent");
  assert.deepEqual(missing, [{ key: "common.absent", locale: "pt-BR" }]);
});