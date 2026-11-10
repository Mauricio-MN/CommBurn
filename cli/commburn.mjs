#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { renderSvg } from "../src/core/document.js";
import { createI18n, normalizeLocale, resolveLocale } from "../src/core/i18n.js";
import enCatalog from "../src/locales/en.js";
import ptBrCatalog from "../src/locales/pt-BR.js";

const args = process.argv.slice(2);
const positional = [];
let requestedLocale;
let invalidLocale = false;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--locale") {
    requestedLocale = args[index + 1];
    index += 1;
    if (!requestedLocale || !normalizeLocale(requestedLocale)) invalidLocale = true;
  } else {
    positional.push(args[index]);
  }
}
const [inputPath, outputPath] = positional;
const environmentLocale = (process.env.COMMBURN_LOCALE ?? process.env.LANG ?? "")
  .split(".")[0]
  .replace("_", "-");
const locale = resolveLocale([requestedLocale, environmentLocale]);
const i18n = createI18n({
  locale,
  catalogs: { en: enCatalog, "pt-BR": ptBrCatalog },
  fallbackLocale: "en"
});

function hasErrorTranslation(error) {
  if (typeof error?.code !== "string") return false;
  return error.code.split(".").reduce((value, part) => value?.[part], enCatalog.errors) !== undefined;
}

if (invalidLocale || !inputPath || !outputPath || positional.length !== 2) {
  const message = invalidLocale ? i18n.t("cli.invalidLocale", { locale: requestedLocale }) : i18n.t("cli.usage");
  console.error(message);
  process.exitCode = 2;
} else {
  try {
    let source;
    try {
      source = await readFile(inputPath, "utf8");
    } catch {
      throw new Error(i18n.t("cli.inputReadFailure", { path: inputPath }));
    }
    let document;
    try {
      document = JSON.parse(source);
    } catch {
      throw new Error(i18n.t("cli.invalidJson", { path: inputPath }));
    }
    const svg = renderSvg(document);
    try {
      await writeFile(outputPath, svg, "utf8");
    } catch {
      throw new Error(i18n.t("cli.outputWriteFailure", { path: outputPath }));
    }
  } catch (error) {
    const message = hasErrorTranslation(error) ? i18n.formatError(error) : error.message;
    console.error(`${i18n.t("cli.errorPrefix")} ${message}`);
    process.exitCode = 1;
  }
}
