export function groupMachinePreviewPaths(paths) {
  const groups = new Map();
  for (const plannedPath of paths) {
    const key = plannedPath.kind === "travel" ? "travel" : `work:${plannedPath.layerId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        kind: plannedPath.kind,
        ...(plannedPath.kind === "work" ? { layerId: plannedPath.layerId } : {}),
        segments: []
      };
      groups.set(key, group);
    }
    const [first] = plannedPath.points;
    let pathData = `M${first.xMm} ${first.yMm}`;
    for (let index = 1; index < plannedPath.points.length; index += 1) {
      const point = plannedPath.points[index];
      pathData += ` L${point.xMm} ${point.yMm}`;
    }
    group.segments.push(pathData);
  }
  return [...groups.values()].map(({ kind, layerId, segments }) => ({
    kind,
    ...(layerId === undefined ? {} : { layerId }),
    pathData: segments.join(" ")
  }));
}

export function createMachinePlayback(plan) {
  const entries = [];
  let completedLines = 4;
  for (const path of plan.paths) {
    if (path.kind === "travel") {
      entries.push({ kind: "travel", path, endLine: completedLines + 2 });
      continue;
    }

    completedLines += 4;
    const segmentStartLine = completedLines;
    const segmentCount = path.points.length - 1;
    entries.push({ kind: "work", path, segmentStartLine, segmentCount });
    completedLines += segmentCount;
    if (path.operation !== "fill") completedLines += 1;
  }
  const totalLines = plan.gcode ? plan.gcode.trim().split(/\r?\n/).length : completedLines + 1;
  return { entries, totalLines, timing: createPlaybackTiming(entries, totalLines) };
}

// Assumed rapid speed for playback only; real G0 speed depends on the machine.
const PLAYBACK_RAPID_MM_PER_MINUTE = 3000;

function pathLengthMm(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].xMm - points[index - 1].xMm, points[index].yMm - points[index - 1].yMm);
  }
  return length;
}

// Maps playback line positions to estimated seconds, using each path's feed for work and a rapid speed for travel.
function createPlaybackTiming(entries, totalLines) {
  const lineSeconds = new Float64Array(totalLines);
  for (const entry of entries) {
    if (entry.kind === "travel") {
      const lineIndex = Math.min(entry.endLine - 1, totalLines - 1);
      lineSeconds[lineIndex] += pathLengthMm(entry.path.points) / PLAYBACK_RAPID_MM_PER_MINUTE * 60;
      continue;
    }
    const feed = entry.path.feedMmPerMinute;
    if (!(feed > 0)) continue;
    for (let index = 0; index < entry.segmentCount; index += 1) {
      const a = entry.path.points[index];
      const b = entry.path.points[index + 1];
      lineSeconds[entry.segmentStartLine + index] += Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm) / feed * 60;
    }
  }
  const cumulative = new Float64Array(totalLines + 1);
  for (let line = 0; line < totalLines; line += 1) cumulative[line + 1] = cumulative[line] + lineSeconds[line];
  return {
    totalSeconds: cumulative[totalLines],
    secondsAtLine(line) {
      return cumulative[Math.max(0, Math.min(totalLines, Math.floor(line)))];
    },
    lineAtSeconds(seconds) {
      let low = 0;
      let high = totalLines;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (cumulative[middle] < seconds) low = middle + 1;
        else high = middle;
      }
      return low;
    }
  };
}

export function getMachinePlaybackSegments(entries, fromLine, toLine) {
  const segments = [];
  for (const entry of entries) {
    if (entry.kind === "travel") {
      if (entry.endLine > fromLine && entry.endLine <= toLine) {
        segments.push({
          kind: "travel",
          points: [entry.path.points[0], entry.path.points.at(-1)]
        });
      }
      continue;
    }

    // Work segment `index` covers playback lines [start + index, start + index + 1]; draw only the part inside the window.
    const drawnFrom = Math.max(0, Math.min(entry.segmentCount, fromLine - entry.segmentStartLine));
    const drawnTo = Math.max(0, Math.min(entry.segmentCount, toLine - entry.segmentStartLine));
    for (let index = Math.floor(drawnFrom); index < Math.ceil(drawnTo); index += 1) {
      const start = Math.max(drawnFrom, index) - index;
      const end = Math.min(drawnTo, index + 1) - index;
      if (end <= start) continue;
      segments.push({
        kind: "work",
        layerId: entry.path.layerId,
        ...(entry.path.segmentPowerFractions ? { fraction: entry.path.segmentPowerFractions[index] } : {}),
        points: [pointAlongSegment(entry.path.points, index, start), pointAlongSegment(entry.path.points, index, end)]
      });
    }
  }
  return segments;
}

function pointAlongSegment(points, index, fraction) {
  if (fraction === 0) return points[index];
  if (fraction === 1) return points[index + 1];
  const from = points[index];
  const to = points[index + 1];
  return {
    xMm: from.xMm + (to.xMm - from.xMm) * fraction,
    yMm: from.yMm + (to.yMm - from.yMm) * fraction
  };
}

// Work segments in G-code order, each with the playback line where it starts, in machine coordinates.
export function createMachineTrack(machinePlan) {
  const track = [];
  for (const entry of createMachinePlayback(machinePlan).entries) {
    if (entry.kind !== "work") continue;
    for (let index = 0; index < entry.segmentCount; index += 1) {
      track.push({
        startLine: entry.segmentStartLine + index,
        from: entry.path.points[index],
        to: entry.path.points[index + 1]
      });
    }
  }
  return track;
}

// Finds the work segment nearest to a reported machine position, searching forward from `cursor` only.
// Returns the segment index and fractional playback line, or null when the position is not on the plan.
export function locateMachinePosition(track, position, cursor, { searchWindow = 2000, tolerance = 0.1 } = {}) {
  let best = null;
  const end = Math.min(track.length, cursor + searchWindow);
  for (let index = cursor; index < end; index += 1) {
    const { startLine, from, to } = track[index];
    const { ratio, distance } = nearestOnSegment(position, from, to);
    if (!best || distance < best.distance) best = { index, distance, line: startLine + ratio };
  }
  return best && best.distance <= tolerance ? best : null;
}

function nearestOnSegment(point, from, to) {
  const dx = to.xMm - from.xMm;
  const dy = to.yMm - from.yMm;
  const lengthSquared = dx * dx + dy * dy;
  const along = lengthSquared === 0
    ? 0
    : ((point.xMm - from.xMm) * dx + (point.yMm - from.yMm) * dy) / lengthSquared;
  const ratio = Math.min(1, Math.max(0, along));
  return {
    ratio,
    distance: Math.hypot(point.xMm - (from.xMm + dx * ratio), point.yMm - (from.yMm + dy * ratio))
  };
}

function formatDuration(seconds) {
  const roundedSeconds = Math.ceil(seconds);
  if (roundedSeconds < 60) return `${roundedSeconds} s`;
  const totalMinutes = Math.ceil(roundedSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${totalMinutes} min`;
}

export function formatOperationTimeEstimates(timesByOperation) {
  const operationLabels = [
    ["engrave", "gravação"],
    ["cut", "corte"],
    ["fill", "preenchimento"]
  ];
  const estimates = operationLabels
    .filter(([operation]) => timesByOperation[operation] > 0)
    .map(([operation, label]) => `${label}: ${formatDuration(timesByOperation[operation])}`);
  return estimates.length > 0
    ? `Tempo estimado: ${estimates.join(" · ")}`
    : "Sem trajetórias de trabalho para estimar.";
}
