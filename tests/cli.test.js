import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("CLI exports a validated document to SVG", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commburn-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "job.json");
  const outputPath = join(directory, "job.svg");
  await writeFile(inputPath, JSON.stringify({
    widthMm: 42,
    heightMm: 30,
    origin: { corner: "top-left", flipX: true },
    elements: [{ id: "label", type: "text", xMm: 5, yMm: 8, text: "Teste", fontSizeMm: 3 }]
  }));

  const result = spawnSync(process.execPath, ["cli/commburn.mjs", inputPath, outputPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const svg = await readFile(outputPath, "utf8");
  assert.match(svg, /width="42mm" height="30mm"/);
  assert.match(svg, /<text id="label" font-family="CommBurn Sans"/);
  assert.match(svg, /<tspan x="37" y="8">Teste<\/tspan>/);
  assert.match(svg, /@font-face\{font-family:"CommBurn Sans"/);
});

test("CLI reports invalid documents with a failure exit code", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commburn-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "invalid.json");
  await writeFile(inputPath, JSON.stringify({ widthMm: 0 }));

  const result = spawnSync(process.execPath, ["cli/commburn.mjs", inputPath, join(directory, "job.svg")], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /widthMm deve ser maior que zero/);
});

test("CLI localizes coded document errors using the requested locale", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commburn-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "invalid.json");
  await writeFile(inputPath, JSON.stringify({ widthMm: 0 }));

  const portuguese = spawnSync(process.execPath, ["cli/commburn.mjs", inputPath, join(directory, "pt.svg"), "--locale", "pt-BR"], { encoding: "utf8" });
  const english = spawnSync(process.execPath, ["cli/commburn.mjs", inputPath, join(directory, "en.svg"), "--locale", "en"], { encoding: "utf8" });
  assert.match(portuguese.stderr, /deve ser maior que zero/);
  assert.match(english.stderr, /must be greater than zero/);
});

test("CLI localizes file and JSON errors instead of exposing operating-system messages", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commburn-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const missingPath = join(directory, "missing.json");
  const invalidPath = join(directory, "invalid.json");
  await writeFile(invalidPath, "{invalid");

  const missing = spawnSync(process.execPath, ["cli/commburn.mjs", missingPath, join(directory, "missing.svg"), "--locale", "en"], { encoding: "utf8" });
  const invalid = spawnSync(process.execPath, ["cli/commburn.mjs", invalidPath, join(directory, "invalid.svg"), "--locale", "pt-BR"], { encoding: "utf8" });

  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Could not read input file/);
  assert.doesNotMatch(missing.stderr, /unexpected error|ENOENT/i);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /não contém JSON válido/);
});

test("CLI locale precedence is explicit option, COMMBURN_LOCALE, then LANG", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commburn-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "invalid.json");
  await writeFile(inputPath, JSON.stringify({ widthMm: 0 }));
  const outputPath = join(directory, "job.svg");
  const run = (extraArgs, env) => spawnSync(process.execPath, ["cli/commburn.mjs", inputPath, outputPath, ...extraArgs], {
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
  const explicit = run(["--locale", "pt-BR"], { COMMBURN_LOCALE: "en", LANG: "en_US.UTF-8" });
  const environment = run([], { COMMBURN_LOCALE: "en", LANG: "pt_BR.UTF-8" });
  const language = run([], { COMMBURN_LOCALE: undefined, LANG: "en_US.UTF-8" });

  assert.match(explicit.stderr, /deve ser maior que zero/);
  assert.match(environment.stderr, /must be greater than zero/);
  assert.match(language.stderr, /must be greater than zero/);
});
