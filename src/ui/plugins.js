export const DESKTOP_PLUGIN_API_VERSION = 1;

import { createI18n } from "../core/i18n.js";
import enCatalog from "../locales/en.js";
import ptBrCatalog from "../locales/pt-BR.js";

const defaultI18n = createI18n({
  locale: "pt-BR",
  catalogs: { en: enCatalog, "pt-BR": ptBrCatalog },
  fallbackLocale: "en"
});

const extensionSlots = new Set([
  "toolbar-tools",
  "document-settings",
  "coordinate-settings",
  "layers",
  "object-creation",
  "object-inspector",
  "canvas-header",
  "canvas"
]);

export async function loadDesktopPlugins({
  fetchImpl = fetch,
  documentRef = document,
  importModule = (url) => import(url),
  documentApi = Object.freeze({}),
  i18n = defaultI18n,
  notify = () => {}
} = {}) {
  const response = await fetchImpl("/api/plugins");
  if (!response.ok) throw new Error(`Não foi possível listar plugins (${response.status}).`);
  const result = await response.json();
  if (!Array.isArray(result.plugins)) throw new TypeError("A lista de plugins desktop é inválida.");

  const loaded = [];
  const errors = [];
  for (const plugin of result.plugins) {
    const disposers = [];
    try {
      if (!plugin || plugin.apiVersion !== DESKTOP_PLUGIN_API_VERSION
        || typeof plugin.id !== "string"
        || typeof plugin.name !== "string"
        || typeof plugin.version !== "string"
        || plugin.url !== `/desktop-plugins/${plugin.id}/plugin.mjs`) {
        throw new TypeError("Manifesto de plugin incompatível.");
      }
      const pluginCatalogs = { en: {}, "pt-BR": {} };
      for (const [locale, url] of Object.entries(plugin.localeUrls ?? {})) {
        if (!new Set(["en", "pt-BR"]).has(locale)
          || url !== `/desktop-plugins/${plugin.id}/locales/${locale}.json`) {
          throw new TypeError("O manifesto contém uma URL de idioma inválida.");
        }
        const localeResponse = await fetchImpl(url);
        if (!localeResponse.ok) throw new Error(`Não foi possível carregar o idioma ${locale}.`);
        const catalog = await localeResponse.json();
        if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
          throw new TypeError(`O catálogo ${locale} do plugin é inválido.`);
        }
        pluginCatalogs[locale] = catalog;
      }
      if (Object.keys(pluginCatalogs.en).length === 0) pluginCatalogs.en = pluginCatalogs["pt-BR"];
      if (Object.keys(pluginCatalogs["pt-BR"]).length === 0) pluginCatalogs["pt-BR"] = pluginCatalogs.en;
      const pluginI18n = createI18n({
        locale: i18n.locale,
        catalogs: pluginCatalogs,
        fallbackLocale: "en"
      });
      const unsubscribeLocale = i18n.onLocaleChange((locale) => pluginI18n.setLocale(locale));
      disposers.push(unsubscribeLocale);
      const pluginModule = await importModule(plugin.url);
      if (typeof pluginModule.activate !== "function") {
        throw new TypeError("O módulo deve exportar activate(context).");
      }
      const context = Object.freeze({
        apiVersion: DESKTOP_PLUGIN_API_VERSION,
        plugin: Object.freeze({ id: plugin.id, name: plugin.name, version: plugin.version }),
        i18n: Object.freeze({
          get locale() { return i18n.locale; },
          t: pluginI18n.t,
          formatError: i18n.formatError,
          onLocaleChange: i18n.onLocaleChange
        }),
        document: typeof documentApi === "function" ? documentApi(plugin) : documentApi,
        notify(message) {
          if (typeof message !== "string") throw new TypeError("A notificação do plugin deve ser texto.");
          notify(`[${plugin.name}] ${message}`);
        },
        registerExtension(slot, element) {
          if (!extensionSlots.has(slot)) throw new RangeError(`Slot de extensão desconhecido: ${slot}`);
          if (!element || element.nodeType !== 1 || !element.dataset || typeof element.remove !== "function") {
            throw new TypeError("A extensão deve ser um elemento HTML.");
          }
          const host = documentRef.querySelector(`[data-extension-slot="${slot}"]`);
          if (!host) throw new RangeError(`Slot de extensão indisponível: ${slot}`);
          element.dataset.pluginId = plugin.id;
          host.append(element);
          const dispose = () => element.remove();
          disposers.push(dispose);
          return dispose;
        }
      });
      const dispose = await pluginModule.activate(context);
      if (typeof dispose === "function") disposers.push(dispose);
      loaded.push({ id: plugin.id, name: plugin.name, version: plugin.version });
    } catch (error) {
      for (const dispose of disposers.reverse()) {
        try { dispose(); } catch {}
      }
      errors.push({ id: plugin?.id ?? "unknown", message: error.message });
    }
  }
  return { loaded, errors };
}
