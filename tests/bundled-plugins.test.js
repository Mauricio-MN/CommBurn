import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBundledPlugins } from "../src/core/bundled-plugins.mjs";

async function withDirs(run) {
  const root = await mkdtemp(join(tmpdir(), "commburn-plugins-"));
  try {
    const bundled = join(root, "bundled");
    const installed = join(root, "installed");
    await mkdir(join(bundled, "editor-theme"), { recursive: true });
    await writeFile(join(bundled, "editor-theme", "plugin.mjs"), "export const version = 2;");
    await run({ bundled, installed });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("bundled plugin replaces an older installed copy on the next launch", () => withDirs(async ({ bundled, installed }) => {
  await mkdir(join(installed, "editor-theme"), { recursive: true });
  await writeFile(join(installed, "editor-theme", "plugin.mjs"), "export const version = 1;");

  const updated = await syncBundledPlugins(bundled, installed);

  assert.deepEqual(updated, ["editor-theme"]);
  assert.equal(await readFile(join(installed, "editor-theme", "plugin.mjs"), "utf8"), "export const version = 2;");
}));

test("an up-to-date installed plugin is left untouched", () => withDirs(async ({ bundled, installed }) => {
  await mkdir(join(installed, "editor-theme"), { recursive: true });
  await writeFile(join(installed, "editor-theme", "plugin.mjs"), "export const version = 2;");

  assert.deepEqual(await syncBundledPlugins(bundled, installed), []);
}));

test("a missing bundled directory copies nothing", () => withDirs(async ({ installed }) => {
  assert.deepEqual(await syncBundledPlugins(join(installed, "absent"), installed), []);
}));
