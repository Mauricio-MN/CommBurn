import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { GrblConnection } from "../src/machine/grbl.js";

class MockSerialPort extends EventEmitter {
  writes = [];
  isOpen = true;
  baudRate = 115200;

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

  update({ baudRate }, callback) {
    this.baudRate = baudRate;
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

test("GRBL settings query reads and returns the configured maximum spindle speed", async () => {
  const serialPort = new MockSerialPort();
  serialPort.write = function write(data) {
    this.writes.push(data);
    if (data === "$$\n") {
      setImmediate(() => this.emit("data", Buffer.from("$30=1000\r\n$31=0\r\n$32=1\r\nok\r\n")));
    }
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 100 });

  assert.deepEqual(await connection.querySettings(), { "$30": 1000, "$31": 0, "$32": 1 });
  assert.deepEqual(connection.settings, { "$30": 1000, "$31": 0, "$32": 1 });
  assert.deepEqual(serialPort.writes, ["$$\n"]);
});

test("GRBL settings query returns settings even when $30 is not present", async () => {
  const serialPort = new MockSerialPort();
  serialPort.write = function write(data) {
    this.writes.push(data);
    if (data === "$$\n") setImmediate(() => this.emit("data", Buffer.from("$31=0\r\nok\r\n")));
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 100 });

  assert.deepEqual(await connection.querySettings(), { "$31": 0 });
});

test("GRBL settings query rejects when the controller does not acknowledge the request", async () => {
  const serialPort = new MockSerialPort();
  serialPort.write = function write(data) {
    this.writes.push(data);
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 20 });

  await assert.rejects(connection.querySettings(), /Timed out waiting for controller acknowledgement: \$\$/);
  assert.deepEqual(connection.settings, {});
});

test("GRBL baud detection probes known speeds using status queries only", async () => {
  const serialPort = new MockSerialPort();
  serialPort.write = function write(data) {
    this.writes.push(data);
    if (data === "?" && this.baudRate === 230400) {
      setImmediate(() => this.emit("data", Buffer.from("<Idle|MPos:0,0,0>\r\n")));
    }
  };
  const connection = new GrblConnection(serialPort);

  assert.equal(await connection.detectBaudRate([115200, 230400], { probeTimeoutMs: 20 }), 230400);
  assert.deepEqual(serialPort.writes, ["?", "?"]);
  assert.equal(serialPort.baudRate, 230400);
});

test("GRBL baud detection reports when none of the tested speeds responds", async () => {
  const serialPort = new MockSerialPort();
  serialPort.write = function write(data) {
    this.writes.push(data);
  };
  const connection = new GrblConnection(serialPort);

  assert.equal(await connection.detectBaudRate([115200, 57600], { probeTimeoutMs: 5 }), null);
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

test("stopping cancels an in-flight command without waiting for its timeout and resets the controller", async () => {
  const serialPort = new MockSerialPort();
  serialPort.write = function write(data) {
    this.writes.push(data);
    if (data === "!" || data === "?") setImmediate(() => this.emit("data", Buffer.from("<Hold:0|MPos:0,0,0>\r\n")));
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 5000 });
  const job = connection.sendJob("G21\n");
  setImmediate(() => connection.stopJob());

  await assert.rejects(job, /Job stopped/);
  assert.ok(serialPort.writes.includes("!"));
  assert.equal(serialPort.writes.at(-1), "\x18");
});

test("GRBL sender keeps waiting while the controller reports motion past the timeout", async () => {
  const serialPort = new MockSerialPort();
  let statusReplies = 0;
  serialPort.write = function write(data) {
    this.writes.push(data);
    if (data !== "?") return;
    statusReplies += 1;
    const reply = statusReplies < 15 ? "<Run|MPos:0,0,0>\r\n" : "ok\r\n";
    setImmediate(() => this.emit("data", Buffer.from(reply)));
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 40 });

  await connection.sendLine("G1 X1 Y1 F100");

  assert.equal(statusReplies, 15);
});

test("GRBL sender times out when the controller goes idle without acknowledging", async () => {
  const serialPort = new MockSerialPort();
  serialPort.write = function write(data) {
    this.writes.push(data);
    if (data === "?") setImmediate(() => this.emit("data", Buffer.from("<Idle|MPos:0,0,0>\r\n")));
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 40 });

  await assert.rejects(connection.sendLine("G1 X1 Y1 F100"), /Timed out waiting for controller acknowledgement: G1 X1 Y1 F100/);
  assert.equal(connection.pending, null);
});

test("pausing holds the next line until the job is resumed", async () => {
  const serialPort = new MockSerialPort();
  const connection = new GrblConnection(serialPort, {
    acknowledgementTimeoutMs: 100,
    onProgress: ({ completed }) => {
      if (completed === 1) connection.pauseJob();
    }
  });
  const job = connection.sendJob("G21\nM5\n");
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.deepEqual(serialPort.writes.filter((write) => write.endsWith("\n")), ["G21\n"]);
  assert.equal(serialPort.writes.at(-1), "!");

  connection.resumeJob();
  await job;

  assert.deepEqual(serialPort.writes.filter((write) => write.endsWith("\n")), ["G21\n", "M5\n"]);
  assert.ok(serialPort.writes.indexOf("~") > serialPort.writes.indexOf("!"));
});

test("stopping a paused job sends no more lines and resets the controller", async () => {
  const serialPort = new MockSerialPort();
  const connection = new GrblConnection(serialPort, {
    acknowledgementTimeoutMs: 100,
    onProgress: ({ completed }) => {
      if (completed === 1) connection.pauseJob();
    }
  });
  const job = connection.sendJob("G21\nM5\n");
  await new Promise((resolve) => setTimeout(resolve, 30));
  connection.stopJob();

  await assert.rejects(job, /Job stopped/);
  assert.deepEqual(serialPort.writes.filter((write) => write.endsWith("\n")), ["G21\n"]);
  assert.equal(serialPort.writes.at(-1), "\x18");
});

test("GRBL position, zero and homing are explicit commands that read or set work coordinates", async () => {
  const serialPort = new MockSerialPort();
  const baseWrite = serialPort.write.bind(serialPort);
  serialPort.write = (data) => {
    if (data === "?") {
      serialPort.writes.push(data);
      setImmediate(() => serialPort.emit("data", Buffer.from("<Idle|MPos:15.000,25.000,0.000|WCO:10.000,5.000,0.000>\r\n")));
    } else baseWrite(data);
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 100 });

  const { status, position } = await connection.readPosition();
  assert.equal(status, "Idle");
  assert.deepEqual(position, { machine: { xMm: 15, yMm: 25 }, work: { xMm: 5, yMm: 20 } });

  await connection.setZeroHere(2);
  await connection.home();
  assert.deepEqual(serialPort.writes.filter((line) => line.endsWith("\n")), ["G10 L20 P2 X0 Y0\n", "$H\n"]);
  await assert.rejects(connection.setZeroHere(7), /1 to 6/);
});
