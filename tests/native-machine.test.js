import { test } from "node:test";
import assert from "node:assert/strict";
import { createNativeMachineApi } from "../src/machine/native-machine.js";

function fakePlugin({ openError = null } = {}) {
  const listeners = new Map();
  const plugin = {
    removed: 0,
    ports: [{ path: "/dev/bus/usb/001/002", manufacturer: "FTDI" }],
    async list() {
      return { ports: plugin.ports };
    },
    async addListener(name, callback) {
      listeners.set(name, callback);
      return { remove: () => { listeners.delete(name); plugin.removed++; } };
    },
    async open() {
      if (openError) throw openError;
    },
    async close() {},
    async write({ data }) {
      if (data === "$$\n") queueMicrotask(() => listeners.get("data")?.({ data: "$30=1000\r\nok\r\n" }));
    },
    emit(name, event) {
      listeners.get(name)?.(event);
    }
  };
  return plugin;
}

test("native machine API lists USB ports and reports no connection", async () => {
  const plugin = fakePlugin();
  const machine = createNativeMachineApi({ plugin });
  assert.deepEqual(await machine("/api/ports"), { ports: plugin.ports, warning: null });
  const status = await machine("/api/connection-status");
  assert.equal(status.connected, false);
  assert.equal(status.busy, false);
});

test("native machine releases a disconnected port and can search and connect again", async () => {
  const plugin = fakePlugin();
  const machine = createNativeMachineApi({ plugin });
  const input = { path: plugin.ports[0].path, baudRate: 115200 };
  await machine("/api/connect", "POST", input);
  plugin.emit("error", { message: "USB disconnected" });
  assert.equal((await machine("/api/connection-status")).connected, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(plugin.removed, 2);
  assert.deepEqual((await machine("/api/ports")).ports, plugin.ports);
  assert.equal((await machine("/api/connect", "POST", input)).connected, true);
  await machine("/api/disconnect", "POST");
});

test("native machine rejects jobs after a failed reset and can switch ports after disconnect", async () => {
  const plugin = fakePlugin();
  plugin.ports.push({ path: "/dev/bus/usb/001/003" });
  let reset = false;
  let commandSent;
  const command = new Promise((resolve) => { commandSent = resolve; });
  const opened = [];
  plugin.open = async ({ path }) => { opened.push(path); };
  plugin.write = async ({ data }) => {
    if (data === "$$\n") queueMicrotask(() => plugin.emit("data", { data: "$30=1000\r\nok\r\n" }));
    else if (data === "\x18") reset = true;
    else if (data === "?") queueMicrotask(() => plugin.emit("data", { data: `<${reset ? "Alarm" : "Hold:0"}|MPos:0,0,0>\r\n` }));
    else if (data.endsWith("\n")) commandSent();
  };
  const machine = createNativeMachineApi({ plugin });
  await machine("/api/connect", "POST", { path: plugin.ports[0].path, baudRate: 115200 });
  const job = {
    safetyConfirmed: true,
    document: { widthMm: 20, heightMm: 20, elements: [{ id: "r", type: "rect", xMm: 1, yMm: 1, widthMm: 2, heightMm: 2 }] },
    settings: { maxSpindleSpeed: 1000, laserPowerMode: "M3" }
  };
  await machine("/api/job", "POST", job);
  await command;
  await machine("/api/job-stop", "POST");
  const deadline = Date.now() + 2000;
  while ((await machine("/api/connection-status")).busy && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((await machine("/api/connection-status")).resetFailed, true);
  await assert.rejects(machine("/api/job", "POST", job), { code: "grbl.resetNotConfirmed" });
  await machine("/api/disconnect", "POST");
  assert.equal((await machine("/api/ports")).ports.length, 2);
  await machine("/api/connect", "POST", { path: plugin.ports[1].path, baudRate: 115200 });
  assert.equal(opened[1], plugin.ports[1].path);
  await machine("/api/disconnect", "POST");
});

test("native machine API releases its serial listeners when the port fails to open", async () => {
  const plugin = fakePlugin({ openError: new Error("Dispositivo USB não encontrado.") });
  const machine = createNativeMachineApi({ plugin });
  await assert.rejects(
    machine("/api/connect", "POST", { path: "/dev/bus/usb/001/002", baudRate: 115200 }),
    /não encontrado/
  );
  assert.equal(plugin.removed, 2);
});

test("native jobs recheck dynamic laser mode and allow explicit constant power", async () => {
  const plugin = fakePlugin();
  const writes = [];
  let laserMode = 1;
  plugin.write = async ({ data }) => {
    writes.push(data);
    if (data === "$$\n") {
      queueMicrotask(() => plugin.emit("data", { data: `$30=1000\r\n$32=${laserMode}\r\nok\r\n` }));
    } else if (data === "?") {
      queueMicrotask(() => plugin.emit("data", { data: "<Idle|MPos:0,0,0>\r\n" }));
    } else if (data.endsWith("\n")) {
      queueMicrotask(() => plugin.emit("data", { data: "ok\r\n" }));
    }
  };
  const machine = createNativeMachineApi({ plugin });
  await machine("/api/connect", "POST", { path: plugin.ports[0].path, baudRate: 115200 });
  const input = {
    safetyConfirmed: true,
    document: { widthMm: 20, heightMm: 20, elements: [{ id: "r", type: "rect", xMm: 1, yMm: 1, widthMm: 2, heightMm: 2 }] },
    settings: { maxSpindleSpeed: 1000, laserPowerMode: "M4", controllerLaserMode: 1 }
  };
  const waitForCompletion = async () => {
    const deadline = Date.now() + 2000;
    while ((await machine("/api/connection-status")).busy && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal((await machine("/api/job-status")).state, "complete");
  };
  laserMode = 0;
  await assert.rejects(machine("/api/job", "POST", input), { code: "grbl.laserModeRequired" });
  assert.equal((await machine("/api/connection-status")).busy, false);
  assert.deepEqual(writes, ["$$\n", "$$\n"]);
  input.settings.laserPowerMode = "M3";
  assert.equal((await machine("/api/job", "POST", input)).accepted, true);
  await waitForCompletion();
  assert.ok(writes.some((line) => line.startsWith("M3 S")));
  assert.equal(writes.filter((line) => line === "$$\n").length, 2);
  laserMode = 1;
  input.settings.laserPowerMode = "M4";
  assert.equal((await machine("/api/job", "POST", input)).accepted, true);
  await waitForCompletion();
  assert.ok(writes.some((line) => line.startsWith("M4 S")));
  assert.equal(writes.filter((line) => line === "$$\n").length, 3);
  await machine("/api/disconnect", "POST");
});
