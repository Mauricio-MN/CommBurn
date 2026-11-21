import { test } from "node:test";
import assert from "node:assert/strict";
import { createNativeMachineApi } from "../src/machine/native-machine.js";

function fakePlugin({ openError = null } = {}) {
  const plugin = {
    removed: 0,
    ports: [{ path: "/dev/bus/usb/001/002", manufacturer: "FTDI" }],
    async list() {
      return { ports: plugin.ports };
    },
    async addListener() {
      return { remove: () => plugin.removed++ };
    },
    async open() {
      if (openError) throw openError;
    },
    async close() {},
    async write() {}
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

test("native machine API releases its serial listeners when the port fails to open", async () => {
  const plugin = fakePlugin({ openError: new Error("Dispositivo USB não encontrado.") });
  const machine = createNativeMachineApi({ plugin });
  await assert.rejects(
    machine("/api/connect", "POST", { path: "/dev/bus/usb/001/002", baudRate: 115200 }),
    /não encontrado/
  );
  assert.equal(plugin.removed, 2);
});
