import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listSerialPorts, readJson, startServer } from "../server.mjs";
import { Readable } from "node:stream";

test("JSON request bodies must not be empty", async () => {
  await assert.rejects(readJson(Readable.from([])), { message: "Request body must contain JSON" });
  assert.deepEqual(await readJson(Readable.from(['{"ok":true}'])), { ok: true });
});

test("serial port discovery stays usable when Linux does not provide udevadm", async () => {
  const missingUdevadm = Object.assign(new Error("spawn udevadm ENOENT"), {
    code: "ENOENT",
    path: "udevadm"
  });

  assert.deepEqual(await listSerialPorts(async () => { throw missingUdevadm; }), {
    ports: [],
    warning: "A lista automática de portas não está disponível neste Linux. Você ainda pode digitar o caminho da porta manualmente."
  });
});

test("serial port discovery still reports errors other than missing udevadm", async () => {
  await assert.rejects(
    listSerialPorts(async () => { throw new Error("permission denied"); }),
    /permission denied/
  );
});

test("server can be started on an ephemeral port and closed by an embedding app", async (context) => {
  const runningServer = await startServer({ port: 0 });
  context.after(() => runningServer.close());

  const pageResponse = await fetch(runningServer.url);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /CommBurn/);

  const brandResponse = await fetch(`${runningServer.url}/commburn-icon.svg`);
  assert.equal(brandResponse.status, 200);
  assert.match(brandResponse.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(await brandResponse.text(), /<svg/);
  for (const fontFile of ["DejaVuSans.woff", "DejaVuSerif.woff", "DejaVuSansMono.woff"]) {
    const fontResponse = await fetch(`${runningServer.url}/src/core/fonts/${fontFile}`);
    assert.equal(fontResponse.status, 200);
    assert.match(fontResponse.headers.get("content-type"), /font\/woff/);
    assert.ok((await fontResponse.arrayBuffer()).byteLength > 30000);
  }
  const parserResponse = await fetch(`${runningServer.url}/node_modules/opentype.js/dist/opentype.mjs`);
  assert.equal(parserResponse.status, 200);
  assert.match(parserResponse.headers.get("content-type"), /javascript/);
  assert.equal((await fetch(`${runningServer.url}/not-allowlisted.svg`)).status, 404);

  const statusResponse = await fetch(`${runningServer.url}/api/connection-status`);
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), {
    connected: false,
    simulated: false,
    busy: false,
    settings: null,
    jobStatus: { state: "idle", completed: 0, total: 0, error: null }
  });
  assert.deepEqual(await (await fetch(`${runningServer.url}/api/plugins`)).json(), { plugins: [] });

  const settingsResponse = await fetch(`${runningServer.url}/api/settings`, { method: "POST" });
  assert.equal(settingsResponse.status, 400);
  assert.match((await settingsResponse.json()).error, /Conecte uma controladora GRBL/);
});

test("desktop server lists and serves only valid local plugins", async (context) => {
  const pluginRoot = await mkdtemp(join(tmpdir(), "commburn-plugins-"));
  const pluginDirectory = join(pluginRoot, "demo-plugin");
  await mkdir(pluginDirectory);
  await mkdir(join(pluginDirectory, "locales"));
  await writeFile(join(pluginDirectory, "manifest.json"), JSON.stringify({
    id: "demo-plugin",
    name: "Demo",
    version: "1.0.0",
    apiVersion: 1,
    entry: "plugin.mjs",
    locales: { en: "locales/en.json", "pt-BR": "locales/pt-BR.json" }
  }));
  await writeFile(join(pluginDirectory, "plugin.mjs"), "export function activate() {}\n");
  await writeFile(join(pluginDirectory, "locales/en.json"), JSON.stringify({ title: "Demo" }));
  await writeFile(join(pluginDirectory, "locales/pt-BR.json"), JSON.stringify({ title: "Demonstração" }));
  await mkdir(join(pluginRoot, "invalid-plugin"));
  await writeFile(join(pluginRoot, "invalid-plugin", "manifest.json"), JSON.stringify({
    id: "invalid-plugin",
    name: "Invalid",
    version: "1.0.0",
    apiVersion: 1,
    entry: "../outside.mjs"
  }));
  const symlinkPluginDirectory = join(pluginRoot, "symlink-plugin");
  await mkdir(join(symlinkPluginDirectory, "locales"), { recursive: true });
  await writeFile(join(symlinkPluginDirectory, "manifest.json"), JSON.stringify({
    id: "symlink-plugin",
    name: "Symlink",
    version: "1.0.0",
    apiVersion: 1,
    entry: "plugin.mjs",
    locales: { en: "locales/en.json" }
  }));
  await writeFile(join(symlinkPluginDirectory, "plugin.mjs"), "export function activate() {}\n");
  const outsideCatalog = join(pluginRoot, "outside.json");
  await writeFile(outsideCatalog, JSON.stringify({ title: "Outside" }));
  await symlink(outsideCatalog, join(symlinkPluginDirectory, "locales/en.json"));
  const runningServer = await startServer({ port: 0, pluginDirectory: pluginRoot });
  context.after(async () => {
    await runningServer.close();
    await rm(pluginRoot, { recursive: true, force: true });
  });

  const listing = await (await fetch(`${runningServer.url}/api/plugins`)).json();
  assert.deepEqual(listing.plugins.map(({ id }) => id), ["demo-plugin"]);
  const moduleResponse = await fetch(`${runningServer.url}${listing.plugins[0].url}`);
  assert.equal(moduleResponse.status, 200);
  assert.match(moduleResponse.headers.get("content-type"), /javascript/);
  assert.match(await moduleResponse.text(), /activate/);
  assert.equal(listing.plugins[0].localeUrls["pt-BR"], "/desktop-plugins/demo-plugin/locales/pt-BR.json");
  const localeResponse = await fetch(`${runningServer.url}${listing.plugins[0].localeUrls["pt-BR"]}`);
  assert.equal(localeResponse.status, 200);
  assert.deepEqual(await localeResponse.json(), { title: "Demonstração" });
  assert.equal((await fetch(`${runningServer.url}/desktop-plugins/demo-plugin/locales/fr.json`)).status, 404);
  assert.equal((await fetch(`${runningServer.url}/desktop-plugins/demo-plugin/locales/../manifest.json`)).status, 404);
  assert.equal((await fetch(`${runningServer.url}/desktop-plugins/unknown/plugin.mjs`)).status, 404);
  assert.equal((await fetch(`${runningServer.url}/desktop-plugins/symlink-plugin/locales/en.json`)).status, 404);
});