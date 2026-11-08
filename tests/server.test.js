import assert from "node:assert/strict";
import { test } from "node:test";
import { startServer } from "../server.mjs";

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
    jobStatus: { state: "idle", completed: 0, total: 0, error: null }
  });
});