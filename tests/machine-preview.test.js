import assert from "node:assert/strict";
import test from "node:test";
import { planGrblJob } from "../src/core/document.js";
import {
  createMachinePlayback,
  createMachineTrack,
  formatOperationTimeEstimates,
  getMachinePlaybackSegments,
  groupMachinePreviewPaths,
  locateMachinePosition,
  setPlaybackRapidMmPerMinute
} from "../src/ui/machine-preview.js";

test("machine preview groups many work and travel paths into one SVG path per layer and kind", () => {
  const paths = Array.from({ length: 20_000 }, (_, index) => ({
    kind: index % 2 === 0 ? "work" : "travel",
    layerId: "engrave",
    points: [{ xMm: index, yMm: 0 }, { xMm: index + 1, yMm: 1 }]
  }));
  const grouped = groupMachinePreviewPaths(paths);

  assert.equal(grouped.length, 2);
  assert.equal(grouped.find((path) => path.kind === "work").pathData.match(/M/g).length, 10_000);
  assert.equal(grouped.find((path) => path.kind === "travel").pathData.match(/M/g).length, 10_000);
});

test("machine preview formats estimated work times by operation", () => {
  assert.equal(formatOperationTimeEstimates({ engrave: 8.2, cut: 65, fill: 3661 }), "Tempo estimado: gravação: 9 s · corte: 2 min · preenchimento: 1 h 2 min");
  assert.equal(formatOperationTimeEstimates({ engrave: 0, cut: 0, fill: 0 }), "Sem trajetórias de trabalho para estimar.");
});

test("machine simulation playback maps acknowledged G-code lines to work and rapid segments", () => {
  const plan = planGrblJob({
    widthMm: 30,
    heightMm: 20,
    layers: [{ id: "engrave" }, { id: "fill", operation: "fill", fillSpacingMm: 2 }],
    elements: [
      { id: "first", type: "rect", xMm: 1, yMm: 1, widthMm: 3, heightMm: 2, layerId: "engrave" },
      { id: "second", type: "rect", xMm: 10, yMm: 10, widthMm: 3, heightMm: 2, layerId: "fill" }
    ]
  }, { maxSpindleSpeed: 1000 });
  const playback = createMachinePlayback(plan);

  assert.equal(playback.totalLines, plan.gcode.trim().split(/\r?\n/).length);
  const completed = getMachinePlaybackSegments(playback.entries, 0, playback.totalLines);
  assert.equal(completed.filter((segment) => segment.kind === "travel").length, plan.stats.rapidMoveCount);
  assert.equal(completed.filter((segment) => segment.kind === "work").length,
    plan.paths.filter((path) => path.kind === "work").reduce((count, path) => count + path.points.length - 1, 0));
});

test("machine simulation playback timing follows the layer feed for work time", () => {
  const job = (feedMmPerMinute) => ({
    widthMm: 30,
    heightMm: 20,
    layers: [{ id: "engrave", feedMmPerMinute }],
    elements: [{ id: "line", type: "path", xMm: 1, yMm: 1, widthMm: 20, heightMm: 1, layerId: "engrave", pathData: "M 0 0 L 20 0" }]
  });
  const slow = createMachinePlayback(planGrblJob(job(300), { maxSpindleSpeed: 1000 })).timing;
  const fast = createMachinePlayback(planGrblJob(job(3000), { maxSpindleSpeed: 1000 })).timing;
  assert.ok(slow.totalSeconds > fast.totalSeconds * 5);
  assert.equal(fast.lineAtSeconds(fast.totalSeconds), createMachinePlayback(planGrblJob(job(3000), { maxSpindleSpeed: 1000 })).totalLines);
});

test("machine simulation playback times rapid moves at the controller max rate", () => {
  const plan = planGrblJob({
    widthMm: 100,
    heightMm: 100,
    layers: [{ id: "engrave" }],
    elements: [
      { id: "a", type: "rect", xMm: 1, yMm: 1, widthMm: 2, heightMm: 2, layerId: "engrave" },
      { id: "b", type: "rect", xMm: 80, yMm: 80, widthMm: 2, heightMm: 2, layerId: "engrave" }
    ]
  }, { maxSpindleSpeed: 1000 });
  setPlaybackRapidMmPerMinute(600);
  const slowRapid = createMachinePlayback(plan).timing.totalSeconds;
  setPlaybackRapidMmPerMinute(6000);
  const fastRapid = createMachinePlayback(plan).timing.totalSeconds;
  setPlaybackRapidMmPerMinute(null);
  assert.ok(slowRapid > fastRapid);
});

test("machine simulation playback returns only segments acknowledged in the current interval", () => {
  const path = {
    kind: "work",
    layerId: "engrave",
    points: [{ xMm: 0, yMm: 0 }, { xMm: 1, yMm: 0 }, { xMm: 2, yMm: 0 }],
    operation: "engrave"
  };
  const playback = createMachinePlayback({
    paths: [
      { kind: "travel", points: [{ xMm: 2, yMm: 0 }, { xMm: 3, yMm: 0 }] },
      path
    ]
  });

  assert.equal(getMachinePlaybackSegments(playback.entries, 0, 6)[0].kind, "travel");
  assert.deepEqual(getMachinePlaybackSegments(playback.entries, 6, 8), []);
  assert.deepEqual(getMachinePlaybackSegments(playback.entries, 8, 9), [{
    kind: "work",
    layerId: "engrave",
    points: [path.points[0], path.points[1]]
  }]);
  assert.equal(getMachinePlaybackSegments(playback.entries, 9, 10)[0].points[0].xMm, 1);
});

test("machine simulation playback draws a segment up to a fractional line without repeating it", () => {
  const playback = createMachinePlayback({
    paths: [{ kind: "work", layerId: "engrave", points: [{ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 0 }], operation: "engrave" }]
  });

  const [first] = getMachinePlaybackSegments(playback.entries, 8, 8.25);
  assert.deepEqual(first.points.map((point) => point.xMm), [0, 2.5]);
  const [next] = getMachinePlaybackSegments(playback.entries, 8.25, 8.5);
  assert.deepEqual(next.points.map((point) => point.xMm), [2.5, 5]);
});

test("machine position locates the playback line on the plan and only searches forward", () => {
  const track = createMachineTrack({
    paths: [{
      kind: "work",
      layerId: "engrave",
      points: [{ xMm: 0, yMm: 0 }, { xMm: 10, yMm: 0 }, { xMm: 10, yMm: 10 }],
      operation: "engrave"
    }]
  });

  assert.equal(track.length, 2);
  const onFirst = locateMachinePosition(track, { xMm: 2.5, yMm: 0 }, 0);
  assert.equal(onFirst.index, 0);
  assert.ok(Math.abs(onFirst.line - 8.25) < 1e-9);
  const onSecond = locateMachinePosition(track, { xMm: 10, yMm: 5 }, onFirst.index);
  assert.equal(onSecond.index, 1);
  assert.ok(Math.abs(onSecond.line - 9.5) < 1e-9);
  assert.equal(locateMachinePosition(track, { xMm: 2.5, yMm: 0 }, 1), null);
  assert.equal(locateMachinePosition(track, { xMm: 50, yMm: 50 }, 0), null);
});
