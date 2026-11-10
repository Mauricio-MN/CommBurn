export const SUPPORTED_LOCALES = Object.freeze(["en", "pt-BR"]);

export function normalizeLocale(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let canonical;
  try {
    [canonical] = Intl.getCanonicalLocales(value.trim());
  } catch {
    return null;
  }
  const [language] = canonical.split("-");
  if (language === "en") return "en";
  if (language === "pt") return "pt-BR";
  return null;
}

export function resolveLocale(preferences, {
  supportedLocales = SUPPORTED_LOCALES,
  fallbackLocale = "pt-BR"
} = {}) {
  const supported = new Set(supportedLocales);
  const candidates = Array.isArray(preferences) ? preferences : [preferences];
  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate);
    if (locale && supported.has(locale)) return locale;
  }
  return supported.has(fallbackLocale) ? fallbackLocale : supportedLocales[0];
}

function readMessage(messages, key) {
  return key.split(".").reduce((value, segment) => value?.[segment], messages);
}

function selectPlural(message, count, locale) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return message;
  const category = new Intl.PluralRules(locale).select(Number(count));
  return message[category] ?? message.other;
}

function interpolate(message, values) {
  return String(message).replace(/\{([\w.]+)\}/g, (placeholder, key) => {
    const value = values[key];
    return value === undefined || value === null ? placeholder : String(value);
  });
}

export class CommBurnError extends Error {
  constructor(code, params = {}, options = {}) {
    super(options.message ?? code, options);
    this.name = "CommBurnError";
    this.code = code;
    this.params = Object.freeze({ ...params });
  }
}

export class CommBurnTypeError extends TypeError {
  constructor(code, params = {}, options = {}) {
    super(options.message ?? code, options);
    this.name = "TypeError";
    this.code = code;
    this.params = Object.freeze({ ...params });
  }
}

export class CommBurnRangeError extends RangeError {
  constructor(code, params = {}, options = {}) {
    super(options.message ?? code, options);
    this.name = "RangeError";
    this.code = code;
    this.params = Object.freeze({ ...params });
  }
}

export function createI18n({
  locale,
  catalogs,
  fallbackLocale = "en",
  supportedLocales = Object.keys(catalogs ?? {}),
  onMissing
} = {}) {
  if (!catalogs || typeof catalogs !== "object") throw new TypeError("Localization catalogs are required");
  const supported = [...new Set(supportedLocales)];
  if (!supported.length || supported.some((item) => !catalogs[item])) {
    throw new TypeError("Every supported locale must have a catalog");
  }
  const fallback = resolveLocale(fallbackLocale, { supportedLocales: supported, fallbackLocale: supported[0] });
  const listeners = new Set();
  let activeLocale = resolveLocale(locale, { supportedLocales: supported, fallbackLocale });

  function t(key, values = {}) {
    let message = readMessage(catalogs[activeLocale], key);
    if (message === undefined) message = readMessage(catalogs[fallback], key);
    if (message === undefined) {
      onMissing?.({ key, locale: activeLocale });
      return key;
    }
    message = selectPlural(message, values.count, activeLocale);
    return interpolate(message, values);
  }

  function setLocale(nextLocale) {
    const resolved = resolveLocale(nextLocale, { supportedLocales: supported, fallbackLocale });
    if (resolved === activeLocale) return activeLocale;
    const previousLocale = activeLocale;
    activeLocale = resolved;
    for (const listener of listeners) listener(activeLocale, previousLocale);
    return activeLocale;
  }

  return Object.freeze({
    get locale() { return activeLocale; },
    get supportedLocales() { return [...supported]; },
    setLocale,
    t,
    formatNumber(value, options) {
      return new Intl.NumberFormat(activeLocale, options).format(value);
    },
    formatError(error) {
      if (error?.code && typeof error.code === "string") {
        const key = `errors.${error.code}`;
        if (readMessage(catalogs[activeLocale], key) !== undefined || readMessage(catalogs[fallback], key) !== undefined) {
          return t(key, error.params ?? {});
        }
      }
      return t("errors.unexpected");
    },
    onLocaleChange(listener) {
      if (typeof listener !== "function") throw new TypeError("Locale listener must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}