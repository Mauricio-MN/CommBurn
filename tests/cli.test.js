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
  assert.match(svg, /x="37" y="8"/);
});

test("CLI reports invalid documents with a failure exit code", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "commburn-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputPath = join(directory, "invalid.json");
  await writeFile(inputPath, JSON.stringify({ widthMm: 0 }));

  const result = spawnSync(process.execPath, ["cli/commburn.mjs", inputPath, join(directory, "job.svg")], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /widthMm must be greater than zero/);
});
