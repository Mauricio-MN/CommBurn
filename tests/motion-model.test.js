import assert from "node:assert/strict";
import { test } from "node:test";
import { SimulatedSerialPort } from "../server.mjs";
import { planGrblJob } from "../src/core/document.js";
import {
  MotionPlanner,
  createMotionBlock,
  createMotionLimits,
  distanceAlongBlock,
  speedAlongBlock,
  interpretGcodeLine,
  junctionSpeed,
  speedProfile
} from "../src/machine/motion-model.js";

const limits = createMotionLimits();
const origin = { xMm: 0, yMm: 0 };

test("the virtual controller executes a head-relative job without changing its work zero", async () => {
  const port = new SimulatedSerialPort();
  const initial = { ...port.position };
  port.zero = { xMm: 3, yMm: 4 };
  const plan = planGrblJob({
    widthMm: 30, heightMm: 30,
    elements: [{ id: "shape", type: "rect", xMm: 8, yMm: 8, widthMm: 1, heightMm: 1 }]
  }, { maxSpindleSpeed: 1000, startFrom: "objects", startAnchor: "center" });
  const moves = [];
  const queueMotion = port.queueMotion.bind(port);
  port.queueMotion = (motion) => {
    queueMotion(motion);
    moves.push({ ...port.plannedPosition });
  };
  try {
    for (const line of plan.gcode.trim().split("\n")) port.write(`${line}\n`);
    await waitForStatus(port, "Idle");
    const first = plan.paths.find((path) => path.kind === "work").points[0];
    assert.ok(Math.abs(moves[0].xMm - initial.xMm - first.xMm) < 1e-6);
    assert.ok(Math.abs(moves[0].yMm - initial.yMm - first.yMm) < 1e-6);
    assert.ok(Math.abs(port.position.xMm - initial.xMm) < 1e-6);
    assert.ok(Math.abs(port.position.yMm - initial.yMm) < 1e-6);
    assert.deepEqual(port.zero, { xMm: 3, yMm: 4 });
    assert.equal(port.modal.relative, false);
  } finally {
    port.close(() => {});
  }
});

test("a move at the feed rate takes distance over speed plus acceleration ramps", () => {
  const profile = speedProfile(100, 0, 0, 10, 1000);
  assert.ok(Math.abs(profile.duration - 10.01) < 1e-9);
  assert.equal(profile.exitSpeed, 0);
});

test("short moves never reach the feed rate and respect the acceleration limit", () => {
  const profile = speedProfile(1, 0, 0, 1000, 500);
  assert.ok(Math.abs(profile.duration - 2 * Math.sqrt(1 / 500)) < 1e-9);
});

test("feed rate and per-axis machine rates cap the block speed", () => {
  const feed = createMotionBlock({ from: origin, to: { xMm: 10, yMm: 0 }, feedMmPerMinute: 600, rapid: false }, limits);
  assert.equal(feed.maxSpeed, 10);
  const rapid = createMotionBlock({ from: origin, to: { xMm: 10, yMm: 0 }, feedMmPerMinute: 600, rapid: true }, limits);
  assert.equal(rapid.maxSpeed, 100);
  const diagonal = createMotionBlock({ from: origin, to: { xMm: 10, yMm: 10 }, feedMmPerMinute: 60000, rapid: true }, limits);
  assert.ok(Math.abs(diagonal.maxSpeed - 100 * Math.SQRT2) < 1e-9);
  assert.ok(Math.abs(diagonal.acceleration - 500 * Math.SQRT2) < 1e-9);
});

test("corners slow down by the GRBL junction rule and straight lines keep speed", () => {
  const east = createMotionBlock({ from: origin, to: { xMm: 1, yMm: 0 }, feedMmPerMinute: 6000, rapid: false }, limits);
  const north = createMotionBlock({ from: { xMm: 1, yMm: 0 }, to: { xMm: 1, yMm: 1 }, feedMmPerMinute: 6000, rapid: false }, limits);
  const straight = createMotionBlock({ from: { xMm: 1, yMm: 0 }, to: { xMm: 2, yMm: 0 }, feedMmPerMinute: 6000, rapid: false }, limits);
  const reverse = createMotionBlock({ from: { xMm: 1, yMm: 0 }, to: { xMm: 0, yMm: 0 }, feedMmPerMinute: 6000, rapid: false }, limits);
  assert.equal(junctionSpeed(east, straight, limits), 100);
  assert.equal(junctionSpeed(east, reverse, limits), 0);
  assert.ok(Math.abs(junctionSpeed(east, north, limits) - 3.4743) < 1e-3);
});

test("G-code lines are read for motion, feed and the missing-feed error", () => {
  const modal = { motion: "G0", relative: false, feedMmPerMinute: undefined };
  assert.equal(interpretGcodeLine("G1 F600", modal).motion, null);
  assert.deepEqual(interpretGcodeLine("G0 X5 Y5", modal).motion, { rapid: true, x: 5, y: 5 });
  assert.equal(interpretGcodeLine("G1 X5", modal).error, 22);
  assert.equal(interpretGcodeLine("G10 L20 P1 X0 Y0", modal).motion, null);
});

test("the planner times a block only after its successor arrives or the lookahead expires", () => {
  const planner = new MotionPlanner({ limits, capacity: 2, lookaheadSeconds: 0.02 });
  planner.add(createMotionBlock({ from: origin, to: { xMm: 1, yMm: 0 }, feedMmPerMinute: 600, rapid: false }, limits), 0);
  assert.deepEqual(planner.update(0.005), []);
  assert.equal(planner.blocks[0].committed, false);
  planner.add(createMotionBlock({ from: { xMm: 1, yMm: 0 }, to: { xMm: 2, yMm: 0 }, feedMmPerMinute: 600, rapid: false }, limits), 0.005);
  assert.deepEqual(planner.update(0.005), []);
  assert.equal(planner.blocks[0].committed, true);
  assert.equal(planner.blocks[0].exitSpeed, 10);
  const finished = planner.update(10000);
  assert.equal(finished.length, 2);
  assert.equal(planner.size, 0);
});

test("the virtual machine runs a move at the feed rate and reports Run until it ends", async () => {
  const port = new SimulatedSerialPort();
  const replies = [];
  port.on("data", (data) => replies.push(data.toString().trim()));
  const started = performance.now();
  for (const line of ["G21", "G90", "G1 F600", "G1 X15 Y20"]) port.write(`${line}\n`);
  assert.equal(port.status, "Run");
  while (port.status !== "Idle") {
    assert.ok(performance.now() - started < 5000, "virtual machine did not finish the move");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const elapsedSeconds = (performance.now() - started) / 1000;
  assert.ok(elapsedSeconds >= 0.5, `finished too early after ${elapsedSeconds} s`);
  assert.deepEqual(port.position, { xMm: 15, yMm: 20 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(replies.filter((reply) => reply === "ok").length, 4);
  port.close(() => {});
});

test("the virtual machine stops acknowledging lines while its planner buffer is full", () => {
  const port = new SimulatedSerialPort();
  for (let index = 1; index <= 20; index += 1) port.write(`G1 X${index} Y0 F6000\n`);
  assert.equal(port.planner.size, 15);
  assert.equal(port.lines.length, 5);
  port.close(() => {});
});

test("the virtual machine reports planner space, live feed and overrides like GRBL 1.1", async () => {
  const port = new SimulatedSerialPort();
  const reports = [];
  port.on("data", (data) => {
    const text = data.toString().trim();
    if (text.startsWith("<")) reports.push(text);
  });
  port.write("G21\nG90\nG1 F600\nG1 X50 Y0\n");
  await new Promise((resolve) => setTimeout(resolve, 120));
  port.write("?");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const report = reports.at(-1);
  assert.match(report, /\|Bf:14,128\|/);
  assert.match(report, /\|FS:600,0\|Ov:100,100,100>$/);
  port.close(() => {});
});

test("simulated feed follows the acceleration, cruise and braking profile", () => {
  const profile = speedProfile(100, 0, 0, 10, 5);
  const block = { profile: { ...profile, acceleration: 5 } };
  assert.equal(speedAlongBlock(block, 0), 0);
  assert.equal(speedAlongBlock(block, 1), 5);
  assert.equal(speedAlongBlock(block, 3), 10);
  assert.ok(Math.abs(speedAlongBlock(block, profile.duration - 1) - 5) < 1e-9);
  assert.equal(speedAlongBlock(block, profile.duration), 0);
});

test("simulator status sends instantaneous feed and zero on hold", async () => {
  const port = new SimulatedSerialPort();
  const now = performance.now() / 1000;
  const block = createMotionBlock({
    from: { xMm: 10, yMm: 20 }, to: { xMm: 110, yMm: 20 }, feedMmPerMinute: 6000, rapid: false
  }, port.limits);
  port.planner.add(block, now - 0.13);
  port.planner.update(now - 0.1);
  const status = () => new Promise((resolve) => {
    port.once("data", (data) => resolve(data.toString()));
    port.write("?");
  });
  try {
    const accelerating = Number((await status()).match(/\|FS:(\d+),/)[1]);
    assert.ok(accelerating >= 3000 && accelerating < 6000, `unexpected accelerating feed: ${accelerating}`);
    port.write("!");
    assert.match(await status(), /\|FS:0,0\|/);
  } finally {
    port.close(() => {});
  }
});

test("a planner feed hold freezes the running block and resumes it where it stopped", () => {
  const planner = new MotionPlanner({ limits });
  planner.add(createMotionBlock({ from: origin, to: { xMm: 10, yMm: 0 }, feedMmPerMinute: 600, rapid: false }, limits), 0);
  planner.update(0.03);
  const endBeforePause = planner.blocks[0].end;
  planner.pause(0.5);
  planner.resume(2.5);
  assert.ok(Math.abs(planner.blocks[0].end - (endBeforePause + 2)) < 1e-9);
  assert.deepEqual(planner.update(endBeforePause + 1.99), []);
  assert.equal(planner.update(endBeforePause + 2.01).length, 1);
});

async function waitForStatus(port, status, timeoutMs = 5000) {
  const started = performance.now();
  while (port.status !== status) {
    assert.ok(performance.now() - started < timeoutMs, `virtual machine did not reach ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("a feed hold freezes the virtual machine and cycle start finishes the same move", async () => {
  const port = new SimulatedSerialPort();
  const started = performance.now();
  for (const line of ["G21", "G90", "G1 F600", "G1 X20 Y20"]) port.write(`${line}\n`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  port.write("!");
  assert.equal(port.status, "Hold:0");
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(port.status, "Hold:0");
  assert.deepEqual(port.position, { xMm: 10, yMm: 20 });
  port.write("~");
  await waitForStatus(port, "Idle");
  const elapsedSeconds = (performance.now() - started) / 1000;
  assert.ok(elapsedSeconds >= 1.5, `resumed move finished too early after ${elapsedSeconds} s`);
  assert.deepEqual(port.position, { xMm: 20, yMm: 20 });
  port.close(() => {});
});

test("soft reset flushes queued virtual motion without moving", async () => {
  const port = new SimulatedSerialPort();
  for (const line of ["G21", "G90", "G1 F600", "G1 X20 Y20", "G1 X30 Y20"]) port.write(`${line}\n`);
  port.write("!");
  port.write("\x18");
  assert.equal(port.status, "Idle");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(port.status, "Idle");
  assert.equal(port.planner.size, 0);
  assert.deepEqual(port.position, { xMm: 10, yMm: 20 });
  port.close(() => {});
});

test("soft reset retains the simulated head position reached before feed hold", () => {
  const port = new SimulatedSerialPort();
  const now = performance.now() / 1000;
  port.planner.add(createMotionBlock({
    from: port.position, to: { xMm: 110, yMm: 20 }, feedMmPerMinute: 600, rapid: false
  }, port.limits), now - 1);
  port.planner.update(now);
  port.write("!");
  const held = port.livePosition(performance.now() / 1000);
  assert.ok(held.xMm > 10);
  port.write("\x18");
  assert.deepEqual(port.position, held);
  assert.deepEqual(port.plannedPosition, held);
  port.close(() => {});
});

test("distance along a block follows its trapezoid and reaches the block length at the end", () => {
  const profile = { ...speedProfile(100, 0, 0, 100, 500), acceleration: 500 };
  const block = { distanceMm: 100, profile };
  assert.ok(Math.abs(distanceAlongBlock(block, 0.1) - 2.5) < 1e-9);
  assert.ok(Math.abs(distanceAlongBlock(block, 0.2) - 10) < 1e-9);
  assert.ok(Math.abs(distanceAlongBlock(block, profile.duration) - 100) < 1e-9);
  assert.equal(distanceAlongBlock(block, profile.duration + 5), 100);
});

test("the virtual machine reports the head partway along the running move and holds it while paused", () => {
  const port = new SimulatedSerialPort();
  port.planner.add(createMotionBlock({ from: { xMm: 10, yMm: 20 }, to: { xMm: 110, yMm: 20 }, feedMmPerMinute: 6000, rapid: false }, port.limits), 0);
  port.planner.update(0.1);
  const midway = port.livePosition(0.1);
  assert.ok(midway.xMm > 10 && midway.xMm < 110, `expected a point along the move, got ${midway.xMm}`);
  assert.equal(midway.yMm, 20);
  port.planner.pause(0.1);
  assert.deepEqual(port.livePosition(3), midway);
  port.close(() => {});
});
