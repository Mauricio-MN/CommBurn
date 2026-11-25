import test from "node:test";
import assert from "node:assert/strict";
import { planGrblJob } from "../src/core/document.js";
import { estimateJobTime, usableMotionSettings } from "../src/machine/job-time.js";
import { interpretGcodeLine } from "../src/machine/motion-model.js";

const settings = { $11: 0.01, $110: 6000, $111: 6000, $120: 100, $121: 100 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("fill estimate includes acceleration and rapid moves, not just distance over feed", () => {
  const plan = planGrblJob({
    widthMm: 30, heightMm: 30,
    layers: [{ id: "fill", operation: "fill", fillSpacingMm: 1, fillAlgorithm: "horizontal-serpentine", feedMmPerMinute: 6000 }],
    elements: [{ id: "box", type: "rect", xMm: 1, yMm: 1, widthMm: 10, heightMm: 2, layerId: "fill" }]
  }, { maxSpindleSpeed: 1000 });
  const estimate = estimateJobTime(plan, settings);
  close(estimate.workSeconds.fill, 3 * 2 * Math.sqrt(10 / 100));
  assert.ok(estimate.travelSeconds > 0.4);
  close(estimate.totalSeconds, estimate.workSeconds.fill + estimate.travelSeconds);
  assert.ok(estimate.totalSeconds > plan.stats.estimatedWorkTimeSecondsByOperation.fill * 4);
  assert.equal(estimate.usingControllerSettings, true);
  assert.equal(estimate.initialTravelUnknown, true);
});

test("relative initial rapid and final return are included without assuming an absolute head position", () => {
  const input = {
    widthMm: 30, heightMm: 30,
    layers: [{ id: "fill", operation: "fill", fillAlgorithm: "horizontal-serpentine", fillSpacingMm: 1, feedMmPerMinute: 600 }],
    elements: [{ id: "box", type: "rect", xMm: 10, yMm: 10, widthMm: 2, heightMm: 2, layerId: "fill" }]
  };
  const relative = planGrblJob(input, { maxSpindleSpeed: 1000, startFrom: "objects", startAnchor: "center" });
  const absolute = planGrblJob(input, { maxSpindleSpeed: 1000 });
  const result = estimateJobTime(relative, settings);
  const absoluteResult = estimateJobTime(absolute, settings);
  assert.equal(result.initialTravelUnknown, false);
  assert.equal(absoluteResult.initialTravelUnknown, true);
  assert.ok(result.travelSeconds > 0);
  const withoutInitial = { ...relative, gcode: relative.gcode.replace("G91", "G90") };
  assert.ok(result.travelSeconds > estimateJobTime(withoutInitial, settings).travelSeconds);
});

test("axis limits, acceleration, junctions and passes affect motion time", () => {
  const plan = planGrblJob({
    widthMm: 40, heightMm: 40,
    layers: [{ id: "cut", operation: "cut", passes: 2, feedMmPerMinute: 6000 }],
    elements: [{ id: "box", type: "rect", xMm: 1, yMm: 1, widthMm: 10, heightMm: 10, layerId: "cut" }]
  }, { maxSpindleSpeed: 1000 });
  const normal = estimateJobTime(plan, settings);
  const slower = estimateJobTime(plan, { ...settings, $110: 600, $120: 10 });
  assert.ok(slower.workSeconds.cut > normal.workSeconds.cut);
  assert.equal(normal.workSeconds.fill, 0);
  const onePass = { ...plan, paths: plan.paths.filter((path) => path.kind !== "work" || path.pass === 1) };
  close(normal.workSeconds.cut, 2 * estimateJobTime(onePass, settings).workSeconds.cut);
});

test("invalid or partial controller limits are labeled as simulated", () => {
  const plan = planGrblJob({
    widthMm: 20, heightMm: 20,
    elements: [{ id: "box", type: "rect", xMm: 1, yMm: 1, widthMm: 2, heightMm: 2 }]
  }, { maxSpindleSpeed: 1000 });
  assert.equal(usableMotionSettings(settings), true);
  for (const invalid of [null, { ...settings, $120: 0 }, { ...settings, $11: NaN }, { $110: 500 }]) {
    assert.equal(usableMotionSettings(invalid), false);
    const result = estimateJobTime(plan, invalid);
    assert.equal(result.usingControllerSettings, false);
    assert.ok(Number.isFinite(result.totalSeconds) && result.totalSeconds > 0);
  }
});

test("estimate is at least the ideal G-code motion time for a relative multipass fill", () => {
  const plan = planGrblJob({
    widthMm: 30, heightMm: 30,
    layers: [{ id: "fill", operation: "fill", fillSpacingMm: 1, passes: 2, feedMmPerMinute: 600 }],
    elements: [{ id: "box", type: "rect", xMm: 10, yMm: 10, widthMm: 4, heightMm: 3, layerId: "fill" }]
  }, { maxSpindleSpeed: 1000, feedMmPerMinute: 1200, startFrom: "objects", startAnchor: "center" });
  let modal = { motion: "G0", relative: false, feedMmPerMinute: undefined };
  let position = { x: 0, y: 0 }, ideal = 0;
  for (const line of plan.gcode.trim().split("\n")) {
    const parsed = interpretGcodeLine(line, modal);
    modal = parsed.modal;
    if (!parsed.motion) continue;
    const x = parsed.motion.x ?? (modal.relative ? 0 : position.x);
    const y = parsed.motion.y ?? (modal.relative ? 0 : position.y);
    const next = modal.relative ? { x: position.x + x, y: position.y + y } : { x, y };
    const distance = Math.hypot(next.x - position.x, next.y - position.y);
    ideal += distance / (parsed.motion.rapid ? 6000 : modal.feedMmPerMinute) * 60;
    position = next;
  }
  const estimate = estimateJobTime(plan, settings);
  assert.ok(estimate.totalSeconds >= ideal);
  close(estimate.workSeconds.fill, 8 * (2 * Math.sqrt(4 / 100)));
  close(position.x, 0);
  close(position.y, 0);
});

test("raster scan time includes motion across zero-power image segments", () => {
  const input = {
    widthMm: 30, heightMm: 30,
    layers: [{ id: "image", operation: "engrave", fillSpacingMm: 1, feedMmPerMinute: 6000 }],
    elements: [{ id: "photo", type: "image", xMm: 5, yMm: 5, widthMm: 4, heightMm: 1, layerId: "image", imageDataUri: "data:image/png;base64,iVBORw0KGgo=" }]
  };
  const gray = Buffer.from([0, 255, 255, 0]).toString("base64");
  const plan = planGrblJob(input, { maxSpindleSpeed: 1000, rasters: { photo: { widthPx: 4, heightPx: 1, gray } } });
  assert.ok(plan.paths.some((path) => path.segmentPowerFractions?.includes(0)));
  close(estimateJobTime(plan, settings).workSeconds.fill, 2 * Math.sqrt(4 / 100));
});
