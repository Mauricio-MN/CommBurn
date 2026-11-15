// Virtual machine motion limits. A real controller reports its own values through $$.
export const simulatedMachineSettings = Object.freeze({
  $11: 0.01,
  $110: 6000,
  $111: 6000,
  $120: 500,
  $121: 500
});

export function createMotionLimits(settings = simulatedMachineSettings) {
  return {
    maxRateMmPerSecond: { x: settings.$110 / 60, y: settings.$111 / 60 },
    accelerationMmPerSecond2: { x: settings.$120, y: settings.$121 },
    junctionDeviationMm: settings.$11
  };
}

// Reads the G-code words of one line. Motion needs G0/G1 modal state plus X or Y words.
export function interpretGcodeLine(line, modal) {
  const words = [...line.toUpperCase().matchAll(/([A-Z])([+-]?(?:\d+\.?\d*|\.\d+))/g)]
    .map(([, letter, value]) => [letter, Number(value)]);
  const codes = words.filter(([letter]) => letter === "G").map(([, value]) => value);
  const word = (letter) => words.findLast(([name]) => name === letter)?.[1];
  const next = { ...modal };
  if (codes.includes(90)) next.relative = false;
  if (codes.includes(91)) next.relative = true;
  if (codes.includes(0)) next.motion = "G0";
  if (codes.includes(1)) next.motion = "G1";
  if (word("F") !== undefined) next.feedMmPerMinute = word("F");

  const x = word("X");
  const y = word("Y");
  const isMotion = (x !== undefined || y !== undefined)
    && !codes.some((code) => code === 10 || code === 28 || code === 30 || code === 92);
  if (!isMotion) return { modal: next, motion: null, error: null };
  if (next.motion === "G1" && !(next.feedMmPerMinute > 0)) return { modal: next, motion: null, error: 22 };
  return { modal: next, motion: { rapid: next.motion === "G0", x, y }, error: null };
}

export function createMotionBlock({ from, to, feedMmPerMinute, rapid }, limits) {
  const dx = to.xMm - from.xMm;
  const dy = to.yMm - from.yMm;
  const distanceMm = Math.hypot(dx, dy);
  const direction = distanceMm > 0 ? { x: dx / distanceMm, y: dy / distanceMm } : { x: 0, y: 0 };
  let maxSpeed = rapid ? Infinity : feedMmPerMinute / 60;
  let acceleration = Infinity;
  for (const [axis, share] of [["x", Math.abs(direction.x)], ["y", Math.abs(direction.y)]]) {
    if (share < 1e-12) continue;
    maxSpeed = Math.min(maxSpeed, limits.maxRateMmPerSecond[axis] / share);
    acceleration = Math.min(acceleration, limits.accelerationMmPerSecond2[axis] / share);
  }
  return { from, to, distanceMm, direction, maxSpeed, acceleration };
}

// Fastest speed through the corner between two blocks, using the GRBL junction deviation rule.
export function junctionSpeed(previous, next, limits) {
  const cosJunctionAngle = -(previous.direction.x * next.direction.x + previous.direction.y * next.direction.y);
  const cap = Math.min(previous.maxSpeed, next.maxSpeed);
  if (cosJunctionAngle > 0.999999) return 0;
  if (cosJunctionAngle < -0.999999) return cap;
  const halfSine = Math.sqrt(0.5 * (1 - cosJunctionAngle));
  const acceleration = Math.min(previous.acceleration, next.acceleration);
  const cornering = Math.sqrt(acceleration * limits.junctionDeviationMm * halfSine / (1 - halfSine));
  return Math.min(cap, cornering);
}

// Trapezoidal move that starts and ends at the given speeds, never exceeding maxSpeed or acceleration.
export function speedProfile(distanceMm, entrySpeed, exitSpeed, maxSpeed, acceleration) {
  const entry = Math.min(entrySpeed, maxSpeed, Math.sqrt(exitSpeed ** 2 + 2 * acceleration * distanceMm));
  const exit = Math.min(exitSpeed, maxSpeed, Math.sqrt(entry ** 2 + 2 * acceleration * distanceMm));
  const peak = Math.min(maxSpeed, Math.sqrt(acceleration * distanceMm + (entry ** 2 + exit ** 2) / 2));
  const accelerationDistance = (peak ** 2 - entry ** 2) / (2 * acceleration);
  const decelerationDistance = (peak ** 2 - exit ** 2) / (2 * acceleration);
  const cruiseDistance = Math.max(0, distanceMm - accelerationDistance - decelerationDistance);
  const duration = (peak - entry) / acceleration + (peak - exit) / acceleration + cruiseDistance / peak;
  return { entrySpeed: entry, exitSpeed: exit, peak, accelerationDistance, cruiseDistance, duration };
}

// Distance covered after `seconds` of a committed block, following the trapezoid it was timed with.
export function distanceAlongBlock(block, seconds) {
  const { entrySpeed, peak, acceleration, accelerationDistance, cruiseDistance, duration } = block.profile;
  seconds = Math.min(Math.max(seconds, 0), duration);
  const accelerationTime = (peak - entrySpeed) / acceleration;
  if (seconds <= accelerationTime) return entrySpeed * seconds + 0.5 * acceleration * seconds ** 2;
  const cruiseTime = cruiseDistance / peak;
  if (seconds <= accelerationTime + cruiseTime) return accelerationDistance + peak * (seconds - accelerationTime);
  const braking = seconds - accelerationTime - cruiseTime;
  const distance = accelerationDistance + cruiseDistance + peak * braking - 0.5 * acceleration * braking ** 2;
  return Math.min(block.distanceMm, distance);
}

// Keeps queued motion blocks like a GRBL planner: each block is timed once its successor is known.
// All times are in seconds.
export class MotionPlanner {
  constructor({ limits, capacity = 15, lookaheadSeconds = 0.02 }) {
    this.limits = limits;
    this.capacity = capacity;
    this.lookaheadSeconds = lookaheadSeconds;
    this.blocks = [];
    this.tail = { end: 0, exitSpeed: 0 };
    this.pausedAt = null;
  }

  get size() {
    return this.blocks.length;
  }

  get full() {
    return this.blocks.length >= this.capacity;
  }

  add(block, now) {
    this.blocks.push({ ...block, acceptedAt: now, committed: false, start: 0, end: 0, exitSpeed: 0 });
  }

  clear() {
    this.blocks = [];
    this.tail = { end: 0, exitSpeed: 0 };
    this.pausedAt = null;
  }

  pause(now) {
    this.pausedAt = now;
  }

  // Shifts committed blocks by the pause length so the running block resumes where it stopped.
  resume(now) {
    const delay = now - this.pausedAt;
    for (const block of this.blocks) {
      if (block.committed) {
        block.start += delay;
        block.end += delay;
      } else {
        block.acceptedAt = now;
      }
    }
    this.pausedAt = null;
  }

  // Times every block whose successor is known, or whose lookahead expired, in queue order.
  commitReady(now) {
    for (const [index, block] of this.blocks.entries()) {
      if (block.committed) continue;
      const next = this.blocks[index + 1];
      if (!next && now - block.acceptedAt < this.lookaheadSeconds) break;
      const previous = index > 0 ? this.blocks[index - 1] : this.tail;
      const start = Math.max(previous.end, block.acceptedAt);
      const exit = next ? junctionSpeed(block, next, this.limits) : 0;
      const profile = speedProfile(block.distanceMm, previous.exitSpeed, exit, block.maxSpeed, block.acceleration);
      Object.assign(block, {
        committed: true,
        start,
        end: start + profile.duration,
        exitSpeed: profile.exitSpeed,
        profile: { ...profile, acceleration: block.acceleration }
      });
    }
  }

  // The committed block being run at `now`, with the time into it; the clock stops while paused.
  activeBlock(now) {
    const block = this.blocks[0];
    if (!block?.committed) return null;
    const time = this.pausedAt ?? now;
    if (time < block.start) return null;
    return { block, seconds: Math.min(time, block.end) - block.start };
  }

  // Returns the blocks that finished by `now`, in order.
  update(now) {
    this.commitReady(now);
    const finished = [];
    while (this.blocks[0]?.committed && this.blocks[0].end <= now) {
      const block = this.blocks.shift();
      this.tail = { end: block.end, exitSpeed: block.exitSpeed };
      finished.push(block);
      this.commitReady(now);
    }
    return finished;
  }
}
