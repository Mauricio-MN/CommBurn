import { createMotionBlock, createMotionLimits, junctionSpeed, simulatedMachineSettings, speedProfile } from "./motion-model.js";

export function usableMotionSettings(settings) {
  return ["$110", "$111", "$120", "$121"].every((key) => Number.isFinite(settings?.[key]) && settings[key] > 0)
    && Number.isFinite(settings?.$11) && settings.$11 >= 0;
}

function pathTime(points, feedMmPerMinute, rapid, limits) {
  const blocks = [];
  for (let index = 1; index < points.length; index += 1) {
    const block = createMotionBlock({ from: points[index - 1], to: points[index], feedMmPerMinute, rapid }, limits);
    if (block.distanceMm > 0) blocks.push(block);
  }
  if (!blocks.length) return 0;
  const speeds = new Float64Array(blocks.length + 1);
  for (let i = 1; i < blocks.length; i += 1) {
    speeds[i] = junctionSpeed(blocks[i - 1], blocks[i], limits);
  }
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    speeds[i] = Math.min(speeds[i], Math.sqrt(speeds[i + 1] ** 2 + 2 * blocks[i].acceleration * blocks[i].distanceMm));
  }
  let seconds = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    speeds[i + 1] = Math.min(speeds[i + 1], Math.sqrt(speeds[i] ** 2 + 2 * block.acceleration * block.distanceMm));
    seconds += speedProfile(block.distanceMm, speeds[i], speeds[i + 1], block.maxSpeed, block.acceleration).duration;
  }
  return seconds;
}

// Stops at each work/rapid path boundary; actual controller buffering and synchronization may differ.
export function estimateJobTime(plan, settings) {
  const usingControllerSettings = usableMotionSettings(settings);
  const limits = createMotionLimits(usingControllerSettings ? settings : simulatedMachineSettings);
  const workSeconds = { engrave: 0, cut: 0, fill: 0 };
  let travelSeconds = 0;
  const relative = plan.gcode.split(/\r?\n/).some((line) => line === "G91");
  const firstWork = plan.paths.find((path) => path.kind === "work");
  if (relative && firstWork) {
    travelSeconds += pathTime([{ xMm: 0, yMm: 0 }, firstWork.points[0]], 0, true, limits);
  }
  for (const path of plan.paths) {
    if (path.kind === "travel") {
      travelSeconds += pathTime(path.points, 0, true, limits);
    } else {
      workSeconds[path.operation] += pathTime(path.points, path.feedMmPerMinute, false, limits);
    }
  }
  return {
    workSeconds,
    travelSeconds,
    totalSeconds: Object.values(workSeconds).reduce((sum, seconds) => sum + seconds, travelSeconds),
    usingControllerSettings,
    initialTravelUnknown: !relative
  };
}
