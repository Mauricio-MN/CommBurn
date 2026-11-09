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
  return { entries, totalLines: completedLines + 1 };
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

    const firstCompleted = Math.max(0, Math.min(entry.segmentCount, fromLine - entry.segmentStartLine));
    const lastCompleted = Math.max(0, Math.min(entry.segmentCount, toLine - entry.segmentStartLine));
    for (let index = firstCompleted; index < lastCompleted; index += 1) {
      segments.push({
        kind: "work",
        layerId: entry.path.layerId,
        points: [entry.path.points[index], entry.path.points[index + 1]]
      });
    }
  }
  return segments;
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
