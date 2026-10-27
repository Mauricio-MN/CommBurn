import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { GrblConnection } from "../src/machine/grbl.js";

class MockSerialPort extends EventEmitter {
  writes = [];
  isOpen = true;

  write(data) {
    this.writes.push(data);
    if (data === "?") {
      setImmediate(() => this.emit("data", Buffer.from("<Idle|MPos:0,0,0>\r\n")));
    } else if (data === "!") {
      setImmediate(() => this.emit("data", Buffer.from("<Hold:0|MPos:0,0,0>\r\n")));
    } else if (data.endsWith("\n")) {
      setImmediate(() => this.emit("data", Buffer.from("ok\r\n")));
    }
  }

  drain(callback) {
    callback(null);
  }
}

test("GRBL sender waits for each acknowledgement and idle status", async () => {
  const serialPort = new MockSerialPort();
  const progress = [];
  const connection = new GrblConnection(serialPort, {
    acknowledgementTimeoutMs: 100,
    onProgress: (value) => progress.push(value)
  });

  await connection.sendJob("G21\nM5\n");

  assert.deepEqual(serialPort.writes.slice(0, 2), ["G21\n", "M5\n"]);
  assert.equal(serialPort.writes.filter((write) => write === "?").length, 2);
  assert.deepEqual(progress, [{ completed: 1, total: 2 }, { completed: 2, total: 2 }]);
});

test("GRBL sender rejects controller errors and requests feed hold", async () => {
  const serialPort = new MockSerialPort();
  serialPort.write = function write(data) {
    this.writes.push(data);
    if (data.endsWith("\n")) setImmediate(() => this.emit("data", Buffer.from("error:2\r\n")));
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 100 });

  await assert.rejects(connection.sendJob("G21\n"), /Controller rejected command/);
  assert.ok(serialPort.writes.includes("!"));
});

test("feed hold cancels an in-flight command without waiting for its timeout", async () => {
  const serialPort = new MockSerialPort();
  serialPort.write = function write(data) {
    this.writes.push(data);
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 5000 });
  const job = connection.sendJob("G21\n");
  setImmediate(() => connection.feedHold());

  await assert.rejects(job, /feed hold/);
  assert.ok(serialPort.writes.includes("!"));
});
