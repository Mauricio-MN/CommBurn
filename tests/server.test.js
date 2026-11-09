import assert from "node:assert/strict";
import { test } from "node:test";
import { listSerialPorts, startServer } from "../server.mjs";

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

  const statusResponse = await fetch(`${runningServer.url}/api/connection-status`);
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), {
    connected: false,
    simulated: false,
    busy: false,
    settings: null,
    jobStatus: { state: "idle", completed: 0, total: 0, error: null }
  });

  const settingsResponse = await fetch(`${runningServer.url}/api/settings`, { method: "POST" });
  assert.equal(settingsResponse.status, 400);
  assert.match((await settingsResponse.json()).error, /Conecte uma controladora GRBL/);
});