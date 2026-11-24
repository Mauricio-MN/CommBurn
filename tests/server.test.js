import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listSerialPorts, readJson, startServer } from "../server.mjs";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

test("JSON request bodies must not be empty", async () => {
  await assert.rejects(readJson(Readable.from([])), { message: "Request body must contain JSON" });
  assert.deepEqual(await readJson(Readable.from(['{"ok":true}'])), { ok: true });
});

test("JSON request bodies honor their size limit and keep multi-byte characters split across chunks", async () => {
  const payload = Buffer.from(JSON.stringify({ text: "Ação" }));
  const split = payload.indexOf(Buffer.from("ç")) + 1;
  assert.deepEqual(await readJson(Readable.from([payload.subarray(0, split), payload.subarray(split)])), { text: "Ação" });

  const large = Buffer.from(JSON.stringify({ data: "x".repeat(2_000_000) }));
  await assert.rejects(readJson(Readable.from([large])), { message: "Request body is too large" });
  assert.deepEqual(await readJson(Readable.from([large]), large.length), { data: "x".repeat(2_000_000) });
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
  const fontFiles = ["DejaVuSans", "DejaVuSerif", "DejaVuSansMono"].flatMap((base) =>
    ["", "-Bold", "-Oblique", "-BoldOblique"].map((suffix) => `${base}${suffix}.woff`));
  for (const fontFile of fontFiles) {
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
    resetFailed: false,
    settings: null,
    jobStatus: { state: "idle", completed: 0, total: 0, error: null }
  });
  assert.deepEqual(await (await fetch(`${runningServer.url}/api/plugins`)).json(), { plugins: [] });

  const settingsResponse = await fetch(`${runningServer.url}/api/settings`, { method: "POST" });
  assert.equal(settingsResponse.status, 400);
  assert.match((await settingsResponse.json()).error, /Conecte uma controladora GRBL/);
});

test("a stopped simulated job releases the controller for another job and a fresh port search", async (context) => {
  const runningServer = await startServer({ port: 0 });
  context.after(() => runningServer.close());
  const request = async (path, body) => {
    const response = await fetch(`${runningServer.url}${path}`, body === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json();
    assert.ok(response.ok, result.error);
    return result;
  };
  await request("/api/simulate-connect", {});
  const job = {
    document: {
      widthMm: 100, heightMm: 80,
      elements: [{ id: "frame", type: "rect", xMm: 10, yMm: 5, widthMm: 20, heightMm: 15 }]
    },
    settings: { feedMmPerMinute: 300, maxSpindleSpeed: 1000, powerPercent: 10 }
  };
  await request("/api/job", job);
  await request("/api/job-stop", {});
  const deadline = Date.now() + 5000;
  let state;
  do {
    state = await request("/api/connection-status");
    if (!state.busy) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.equal(state.busy, false);
  assert.equal(state.jobStatus.state, "stopped");
  assert.equal(state.jobStatus.error, "Job stopped; controller was reset");
  assert.equal((await request("/api/job", job)).accepted, true);
  await request("/api/job-stop", {});
  do {
    state = await request("/api/connection-status");
    if (!state.busy) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.equal(state.busy, false);
  await request("/api/disconnect", {});
  assert.equal((await request("/api/connection-status")).connected, false);
  assert.ok(Array.isArray((await request("/api/ports")).ports));
  assert.equal((await request("/api/simulate-connect", {})).connected, true);
  await request("/api/disconnect", {});
});

test("a failed controller reset blocks new jobs but allows disconnect and another serial port", { timeout: 12_000 }, async (context) => {
  const ports = [];
  class FaultyPort extends EventEmitter {
    constructor({ path }) {
      super();
      this.path = path;
      this.isOpen = false;
      this.writes = [];
      this.reset = false;
      ports.push(this);
    }
    open(callback) { this.isOpen = true; callback(null); }
    drain(callback) { callback(null); }
    close(callback) { this.isOpen = false; this.emit("close"); callback(null); }
    write(data) {
      this.writes.push(data);
      if (data === "$$\n") setImmediate(() => this.emit("data", Buffer.from("$30=1000\r\n$32=1\r\nok\r\n")));
      if (data === "\x18") this.reset = true;
      if (data === "?") setImmediate(() => this.emit("data", Buffer.from(`<${this.reset ? "Run" : "Hold:0"}|MPos:0,0,0>\r\n`)));
    }
  }
  const server = await startServer({ port: 0, serialPortFactory: (options) => new FaultyPort(options) });
  context.after(() => server.close());
  const request = async (path, body) => {
    const response = await fetch(`${server.url}${path}`, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await request("/api/connect", { path: "COM3", baudRate: 115200 })).status, 200);
  const job = {
    safetyConfirmed: true,
    document: { widthMm: 20, heightMm: 20, elements: [{ id: "r", type: "rect", xMm: 1, yMm: 1, widthMm: 2, heightMm: 2 }] },
    settings: { maxSpindleSpeed: 1000, laserPowerMode: "M3" }
  };
  assert.equal((await request("/api/job", job)).status, 202);
  assert.equal((await request("/api/job-stop", {})).status, 200);
  const deadline = Date.now() + 7000;
  let state;
  do {
    state = (await request("/api/connection-status")).body;
    if (!state.busy) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.equal(state.busy, false);
  assert.equal(state.resetFailed, true);
  assert.match(state.jobStatus.error, /controller did not become idle after reset/i);
  const writes = ports[0].writes.length;
  const rejected = await request("/api/job", job);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, "grbl.resetNotConfirmed");
  assert.equal(ports[0].writes.length, writes);
  assert.equal((await request("/api/disconnect", {})).status, 200);
  assert.equal(ports[0].isOpen, false);
  assert.equal((await request("/api/connection-status")).body.resetFailed, false);
  assert.ok(Array.isArray((await request("/api/ports")).body.ports));
  assert.equal((await request("/api/connect", { path: "COM4", baudRate: 115200 })).status, 200);
  assert.equal(ports[1].path, "COM4");
  assert.equal((await request("/api/disconnect", {})).status, 200);
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