import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { GrblConnection, machineAreaFromSettings, verifyDynamicLaserMode } from "../src/machine/grbl.js";

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
    acknowledgementTimeoutMs: 1000,
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

test("dynamic power verification requires a successful fresh $32=1 reading", async () => {
  for (const settings of [{ $32: 0 }, {}, { $32: 2 }]) {
    await assert.rejects(verifyDynamicLaserMode({ querySettings: async () => settings }), { code: "grbl.laserModeRequired" });
  }
  await assert.rejects(verifyDynamicLaserMode({ querySettings: async () => { throw new Error("timeout"); } }),
    { code: "grbl.laserModeQueryFailed", params: { details: "timeout" } });
  await verifyDynamicLaserMode({ querySettings: async () => ({ $32: 1 }) });
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
  let reset = false;
  serialPort.write = function write(data) {
    this.writes.push(data);
    if (data === "\x18") reset = true;
    if (data === "!" || data === "?") setImmediate(() => this.emit("data", Buffer.from(`<${reset ? "Idle" : "Hold:0"}|MPos:0,0,0>\r\n`)));
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 5000 });
  const job = connection.sendJob("G21\n");
  while (!serialPort.writes.includes("G21\n")) await new Promise((resolve) => setImmediate(resolve));
  connection.stopJob();

  await assert.rejects(job, /Job stopped/);
  assert.ok(serialPort.writes.includes("!"));
  assert.ok(serialPort.writes.includes("\x18"));
});

test("GRBL sender keeps waiting while the controller reports motion past the timeout", async () => {
  const serialPort = new MockSerialPort();
  let statusReplies = 0;
  serialPort.write = function write(data) {
    this.writes.push(data);
    if (data !== "?") return;
    statusReplies += 1;
    setImmediate(() => this.emit("data", Buffer.from("<Run|MPos:0,0,0>\r\n")));
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 200 });
  const acknowledge = setTimeout(() => serialPort.emit("data", Buffer.from("ok\r\n")), 1800);
  try {
    await connection.sendLine("G1 X1 Y1 F100");
    assert.ok(statusReplies > 15);
  } finally {
    clearTimeout(acknowledge);
  }
});

test("a paused pending command can resume after the former absolute timeout", async () => {
  const serialPort = new MockSerialPort();
  let holding = false;
  serialPort.write = function write(data) {
    this.writes.push(data);
    if (data === "!") holding = true;
    if (data === "~") {
      holding = false;
      setImmediate(() => this.emit("data", Buffer.from("ok\r\n")));
    }
    if (data === "?") {
      const state = holding ? "Hold:0" : "Idle";
      setImmediate(() => this.emit("data", Buffer.from(`<${state}|MPos:0,0,0>\r\n`)));
    }
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 100 });
  const job = connection.sendJob("G1 X1 F100\n");
  while (!serialPort.writes.includes("G1 X1 F100\n")) await new Promise((resolve) => setImmediate(resolve));
  connection.pauseJob();
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.equal(connection.busy, true);
  connection.resumeJob();
  await job;
});

test("GRBL sender times out when the controller goes idle without acknowledging", async () => {
  const serialPort = new MockSerialPort();
  serialPort.write = function write(data) {
    this.writes.push(data);
    if (data === "?") setImmediate(() => this.emit("data", Buffer.from("<Idle|MPos:0,0,0>\r\n")));
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 40 });

  const startedAt = Date.now();
  await assert.rejects(connection.sendLine("G1 X1 Y1 F100"), /Timed out waiting for controller acknowledgement: G1 X1 Y1 F100/);
  assert.ok(Date.now() - startedAt < 3000);
  assert.equal(connection.pending, null);
});

test("an alarm status interrupts an unacknowledged command", async () => {
  const serialPort = new MockSerialPort();
  serialPort.write = function write(data) {
    if (data === "?") setImmediate(() => this.emit("data", Buffer.from("<Alarm:1|MPos:0,0,0>\r\n")));
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 100 });
  await assert.rejects(connection.sendLine("G1 X1 F100"), /Controller entered Alarm:1 state/);
  assert.equal(connection.pending, null);
});

test("pausing holds the next line until the job is resumed", { timeout: 5000 }, async () => {
  const serialPort = new MockSerialPort();
  let signalPaused;
  const paused = new Promise((resolve) => { signalPaused = resolve; });
  const connection = new GrblConnection(serialPort, {
    acknowledgementTimeoutMs: 100,
    onProgress: ({ completed }) => {
      if (completed === 1) {
        connection.pauseJob();
        signalPaused();
      }
    }
  });
  const job = connection.sendJob("G21\nM5\n");
  await Promise.race([paused, job]);

  assert.deepEqual(serialPort.writes.filter((write) => write.endsWith("\n")), ["G21\n"]);
  assert.equal(serialPort.writes.at(-1), "!");

  connection.resumeJob();
  await job;

  assert.deepEqual(serialPort.writes.filter((write) => write.endsWith("\n")), ["G21\n", "M5\n"]);
  assert.ok(serialPort.writes.indexOf("~") > serialPort.writes.indexOf("!"));
});

test("stopping a paused job sends no more lines and resets the controller", { timeout: 5000 }, async () => {
  const serialPort = new MockSerialPort();
  let signalPaused;
  const paused = new Promise((resolve) => { signalPaused = resolve; });
  const connection = new GrblConnection(serialPort, {
    acknowledgementTimeoutMs: 100,
    onProgress: ({ completed }) => {
      if (completed === 1) {
        connection.pauseJob();
        signalPaused();
      }
    }
  });
  const job = connection.sendJob("G21\nM5\n");
  await Promise.race([paused, job]);
  connection.stopJob();

  await assert.rejects(job, /Job stopped/);
  assert.deepEqual(serialPort.writes.filter((write) => write.endsWith("\n")), ["G21\n"]);
  assert.ok(serialPort.writes.includes("\x18"));
});

test("stopping waits for Hold:0 and for idle after reset before allowing another job", async () => {
  const serialPort = new MockSerialPort();
  let queries = 0;
  let reset = false;
  serialPort.write = function write(data) {
    this.writes.push(data);
    if (data === "\x18") reset = true;
    if (data === "?") {
      queries += 1;
      const state = reset ? "Idle" : queries === 1 ? "Hold:1" : "Hold:0";
      setImmediate(() => this.emit("data", Buffer.from(`<${state}|MPos:0,0,0>\r\n`)));
    }
    if (reset && data.endsWith("\n")) setImmediate(() => this.emit("data", Buffer.from("ok\r\n")));
  };
  const connection = new GrblConnection(serialPort);
  const job = connection.sendJob("G21\n");
  while (!serialPort.writes.includes("G21\n")) await new Promise((resolve) => setImmediate(resolve));
  connection.stopJob();
  await assert.rejects(job, /Job stopped/);
  assert.ok(queries >= 3);
  assert.ok(serialPort.writes.indexOf("\x18") > serialPort.writes.indexOf("?"));
  await connection.sendJob("G21\n");
});

test("a disconnected serial port interrupts a paused job and releases its busy state", async () => {
  const serialPort = new MockSerialPort();
  let disconnects = 0;
  const connection = new GrblConnection(serialPort, {
    onDisconnect: () => { disconnects += 1; },
    onProgress: () => connection.pauseJob()
  });
  const job = connection.sendJob("G21\nM5\n");
  while (!connection.paused) await new Promise((resolve) => setImmediate(resolve));
  serialPort.isOpen = false;
  serialPort.emit("close");
  await assert.rejects(job, /Serial connection closed/);
  assert.equal(connection.busy, false);
  assert.equal(disconnects, 1);
});

test("a failed post-stop reset prevents another job until the connection is recovered", async () => {
  const serialPort = new MockSerialPort();
  let reset = false;
  serialPort.write = function write(data) {
    this.writes.push(data);
    if (data === "\x18") reset = true;
    if (data === "?") {
      const state = reset ? "Alarm" : "Hold:0";
      setImmediate(() => this.emit("data", Buffer.from(`<${state}|MPos:0,0,0>\r\n`)));
    }
  };
  const connection = new GrblConnection(serialPort);
  const job = connection.sendJob("G21\n");
  while (!serialPort.writes.includes("G21\n")) await new Promise((resolve) => setImmediate(resolve));
  connection.stopJob();
  await assert.rejects(job, /Controller entered Alarm state after reset/);
  await assert.rejects(connection.sendJob("G21\n"), /reset was not confirmed/);
});

test("a failed serial close retains listeners and can be retried", async () => {
  const serialPort = new MockSerialPort();
  let attempts = 0;
  let disconnects = 0;
  serialPort.close = (callback) => {
    attempts += 1;
    if (attempts === 1) return callback(new Error("port busy"));
    serialPort.isOpen = false;
    serialPort.emit("close");
    callback(null);
  };
  const connection = new GrblConnection(serialPort, { onDisconnect: () => { disconnects += 1; } });
  await assert.rejects(connection.close(), /port busy/);
  assert.equal(serialPort.listenerCount("data"), 1);
  assert.equal(serialPort.listenerCount("error"), 1);
  await connection.close();
  assert.equal(serialPort.listenerCount("data"), 0);
  assert.equal(disconnects, 0);
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

test("status reports from GRBL 0.9 (comma fields) and 1.1 (pipe fields) update state and position", () => {
  const connection = new GrblConnection(new MockSerialPort());
  connection.receive(Buffer.from("<Idle,MPos:10.000,20.000,0.000,WPos:10.000,20.000,0.000>\r\n"));
  assert.equal(connection.status, "Idle");
  assert.deepEqual(connection.position.machine, { xMm: 10, yMm: 20 });

  connection.receive(Buffer.from("<Run|MPos:1.500,2.500,0.000|FS:500,0>\r\n"));
  assert.equal(connection.status, "Run");
  assert.deepEqual(connection.position.machine, { xMm: 1.5, yMm: 2.5 });

  connection.receive(Buffer.from("<Queue,MPos:3.000,4.000,0.000>\r\n"));
  assert.equal(connection.status, "Queue");
  assert.deepEqual(connection.position.machine, { xMm: 3, yMm: 4 });

  connection.receive(Buffer.from("<Alarm:1|MPos:0.000,0.000,0.000>\r\n"));
  assert.equal(connection.status, "Alarm:1");
});

test("controller settings from GRBL 0.9 and 1.1 are read and produce the bed area", () => {
  const connection = new GrblConnection(new MockSerialPort());
  connection.receive(Buffer.from("$30=1000\r\n$32=1\r\n$130=400.000\r\n$131=300\r\n$22=1\r\nok\r\n"));
  assert.equal(connection.settings.$130, 400);
  assert.equal(connection.settings.$131, 300);
  assert.deepEqual(machineAreaFromSettings(connection.settings), { widthMm: 400, heightMm: 300 });

  connection.receive(Buffer.from("$130=0\r\n$131=abc\r\n"));
  assert.equal(machineAreaFromSettings(connection.settings), null);
  assert.equal(machineAreaFromSettings({ $130: 400 }), null);
  assert.equal(machineAreaFromSettings(undefined), null);
});


test("GRBL job completes on [MSG:Pgm End] once the controller is no longer moving", async () => {
  const serialPort = new MockSerialPort();
  serialPort.write = function write(data) {
    this.writes.push(data);
    if (data === "?") setImmediate(() => this.emit("data", Buffer.from("<Queue|MPos:0,0,0>\r\n")));
    else if (data.endsWith("\n")) setImmediate(() => this.emit("data", Buffer.from("ok\r\n[MSG:Pgm End]\r\n")));
  };
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 1000 });

  await connection.sendJob("G1 X1 Y1 F100\nM5\n");

  assert.equal(connection.programEnded, true);
});

test("GRBL position reports are converted from inches when $13 is set", () => {
  const serialPort = new MockSerialPort();
  const connection = new GrblConnection(serialPort);
  connection.receive(Buffer.from("$13=1\r\n<Idle|MPos:1.0000,2.0000,0.0000|WCO:0.5000,0.5000,0.0000>\r\n"));
  const rounded = (point) => ({ xMm: Number(point.xMm.toFixed(6)), yMm: Number(point.yMm.toFixed(6)) });
  assert.deepEqual(rounded(connection.position.machine), { xMm: 25.4, yMm: 50.8 });
  assert.deepEqual(rounded(connection.position.work), { xMm: 12.7, yMm: 38.1 });
});

test("GRBL position reports stay in millimetres when $13 is not inches", () => {
  const serialPort = new MockSerialPort();
  const connection = new GrblConnection(serialPort);
  connection.receive(Buffer.from("$13=0\r\n<Idle|MPos:10.0,20.0,0.0|WCO:1.0,2.0,0.0>\r\n"));
  assert.deepEqual(connection.position.machine, { xMm: 10, yMm: 20 });
  assert.deepEqual(connection.position.work, { xMm: 9, yMm: 18 });
});

test("late inch settings correct cached coordinates and retain units while settings are reread", async () => {
  const serialPort = new MockSerialPort();
  const connection = new GrblConnection(serialPort);
  connection.receive(Buffer.from("<Idle|MPos:2,3,0|WCO:1,0.5,0|FS:10,0>\r\n"));
  connection.receive(Buffer.from("$13=1\r\n"));
  assert.equal(connection.report.feedMmPerMinute, 254);
  connection.receive(Buffer.from("<Idle|MPos:2,3,0>\r\n"));
  assert.equal(connection.position.work.xMm, 25.4);
  assert.ok(Math.abs(connection.position.work.yMm - 63.5) < 1e-10);
  connection.receive(Buffer.from("<Idle|MPos:2,3,0|FS:10,0>\r\n"));
  assert.equal(connection.report.feedMmPerMinute, 254);
  serialPort.write = function write(data) {
    if (data === "$$\n") setImmediate(() => this.emit("data", Buffer.from("<Idle|MPos:2,3,0>\r\n$13=1\r\nok\r\n")));
  };
  await connection.querySettings();
  assert.equal(connection.position.work.xMm, 25.4);
  connection.receive(Buffer.from("$13=0\r\n<Idle|MPos:50.8,76.2,0>\r\n"));
  assert.equal(connection.position.work.xMm, 25.4);
});

test("omitted or empty status fields are not reported as zero", () => {
  const connection = new GrblConnection(new MockSerialPort());
  connection.receive(Buffer.from("<Idle|MPos:0,0,0>\r\n"));
  assert.equal(connection.report.feedMmPerMinute, null);
  assert.equal(connection.report.plannerBlocks, null);
  connection.receive(Buffer.from("<Run|FS:,0|Bf:,128|Ov:100,,100>\r\n"));
  assert.equal(connection.report.feedMmPerMinute, null);
  assert.equal(connection.report.plannerBlocks, null);
  assert.equal(connection.report.overrides, null);
  connection.receive(Buffer.from("<Idle|FS:0,0|Bf:0,128>\r\n"));
  assert.equal(connection.report.feedMmPerMinute, 0);
  assert.equal(connection.report.plannerBlocks, 0);
});

test("GRBL status reports expose planner buffer, feed, overrides and firmware lines", () => {
  const serialPort = new MockSerialPort();
  const connection = new GrblConnection(serialPort);
  connection.receive(Buffer.from("[VER:1.1h.20190825:]\r\n[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F500 S0]\r\n"));
  connection.receive(Buffer.from("<Run|MPos:1,2,0|Bf:15,120|FS:500,0|Ov:100,100,100|A:S|Pn:P>\r\n"));
  assert.equal(connection.firmwareVersion, "1.1h.20190825");
  assert.ok(connection.parserState.includes("G21"));
  assert.deepEqual(connection.report, {
    plannerBlocks: 15,
    serialBytes: 120,
    feedMmPerMinute: 500,
    spindleRpm: 0,
    overrides: { feedPercent: 100, rapidPercent: 100, spindlePercent: 100 },
    activeSignals: "S",
    pins: "P"
  });
});

test("GRBL keeps waiting for an acknowledgement while the controller answers status queries", { timeout: 5000 }, async () => {
  class SilentPort extends MockSerialPort {
    write(data) {
      this.writes.push(data);
      if (data === "?") setImmediate(() => this.emit("data", Buffer.from("<Idle|MPos:0,0,0>\r\n")));
    }
  }
  const serialPort = new SilentPort();
  const connection = new GrblConnection(serialPort, { acknowledgementTimeoutMs: 200 });
  const sent = connection.sendLine("M5");
  const acknowledge = setTimeout(() => serialPort.emit("data", Buffer.from("ok\r\n")), 600);
  try {
    await sent;
    assert.ok(serialPort.writes.includes("?"));
  } finally {
    clearTimeout(acknowledge);
    connection.rejectPending(new Error("test finished"));
  }
});
