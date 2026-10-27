#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { renderSvg } from "../src/core/document.js";

const [inputPath, outputPath, ...extraArguments] = process.argv.slice(2);
if (!inputPath || !outputPath || extraArguments.length > 0) {
  console.error("Usage: node cli/commburn.mjs <input.json> <output.svg>");
  process.exitCode = 2;
} else {
  try {
    const document = JSON.parse(await readFile(inputPath, "utf8"));
    await writeFile(outputPath, renderSvg(document), "utf8");
  } catch (error) {
    console.error(`CommBurn: ${error.message}`);
    process.exitCode = 1;
  }
}
