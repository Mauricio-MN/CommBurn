export const jobStoppedMessage = "Job stopped; controller was reset";

// GRBL 1.1 separates status fields with "|" and GRBL 0.9 with ","; both start with "<State".
const statusPattern = /^<(Idle|Run|Jog|Hold(?::\d+)?|Alarm(?::\d+)?|Door(?::\d+)?|Check|Home|Sleep|Tool|Queue)(?=[|,>])/i;
const settingPattern = /^\$(\d+)=([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i;

export function parseStatusState(response) {
  return statusPattern.exec(response)?.[1] ?? null;
}

export function parseSettingLine(response) {
  const setting = settingPattern.exec(response);
  if (!setting) return null;
  const value = Number(setting[2]);
  return Number.isFinite(value) ? [Number(setting[1]), value] : null;
}

// $130 and $131 are the maximum travel of X and Y in mm. Both must be positive to describe the bed.
export function machineAreaFromSettings(settings) {
  const isPositive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
  const widthMm = settings?.$130;
  const heightMm = settings?.$131;
  return isPositive(widthMm) && isPositive(heightMm) ? { widthMm, heightMm } : null;
}

function watchdogIntervalMs(timeoutMs) {
  return Math.min(250, Math.max(5, Math.floor(timeoutMs / 4)));
}

export class GrblConnection {
  constructor(serialPort, { acknowledgementTimeoutMs = 10000, onProgress = () => {} } = {}) {
    this.serialPort = serialPort;
    this.acknowledgementTimeoutMs = acknowledgementTimeoutMs;
    this.onProgress = onProgress;
    this.buffer = "";
    this.pending = null;
    this.busy = false;
    this.paused = false;
    this.resumeWaiter = null;
    this.cancelRequested = false;
    this.status = null;
    this.programEnded = false;
    this.statusWaiter = null;
    this.grblSettings = new Map();
    this.serialError = null;
    this.handleData = (data) => this.receive(data);
    this.handleError = (error) => {
      this.serialError = error;
      this.rejectPending(error);
    };
    serialPort.on("data", this.handleData);
    serialPort.on("error", this.handleError);
  }

  receive(data) {
    this.buffer += data.toString("utf8");
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const response = line.trim();
      if (!response) continue;
      const state = parseStatusState(response);
      if (state) {
        this.status = state;
        this.updatePosition(response);
        if (this.pending && /^(Run|Hold|Jog|Home)/.test(this.status)) this.pending.lastProgressAt = Date.now();
        this.statusWaiter?.resolve(this.status);
      } else if (/^\[MSG:Pgm End\]$/i.test(response)) {
        this.programEnded = true;
      } else if (/^ALARM:/i.test(response)) {
        this.rejectPending(new Error(`Controller alarm: ${response}`));
      } else if (/^error:/i.test(response)) {
        this.rejectPending(new Error(`Controller rejected command: ${response}`));
      } else {
        const setting = parseSettingLine(response);
        if (setting) {
          this.grblSettings.set(setting[0], setting[1]);
        } else if (/^ok$/i.test(response)) {
          this.pending?.resolve();
        }
      }
    }
  }

  updatePosition(report) {
    const read = (name) => {
      const match = new RegExp(`[|<,]${name}:([+-]?\\d+(?:\\.\\d+)?),([+-]?\\d+(?:\\.\\d+)?)`).exec(report);
      return match ? { xMm: Number(match[1]), yMm: Number(match[2]) } : null;
    };
    const offset = read("WCO");
    if (offset) this.workOffset = offset;
    const machine = read("MPos");
    const work = read("WPos");
    if (machine) {
      this.position = {
        machine,
        work: this.workOffset
          ? { xMm: machine.xMm - this.workOffset.xMm, yMm: machine.yMm - this.workOffset.yMm }
          : null
      };
    } else if (work) {
      this.position = {
        work,
        machine: this.workOffset
          ? { xMm: work.xMm + this.workOffset.xMm, yMm: work.yMm + this.workOffset.yMm }
          : null
      };
    }
  }

  // Asks for a status report without waiting; the reply updates `position` and `status`.
  requestStatusReport() {
    if (this.busy && this.serialPort.isOpen) this.serialPort.write("?");
  }

  // Reads the head position without moving the machine; null when the controller does not answer.
  async readPosition() {
    if (this.busy) throw new Error("Cannot read the position while a machine job is running");
    this.position = null;
    const status = await this.queryStatus({ timeoutMs: 1000 });
    if (!status) throw new Error("The controller did not report a position");
    return { status, position: this.position };
  }

  // Makes the current head position X0 Y0 of a work coordinate system (G54-G59 -> P1-P6).
  async setZeroHere(slot = 1) {
    if (this.busy) throw new Error("Cannot change the zero while a machine job is running");
    if (!Number.isInteger(slot) || slot < 1 || slot > 6) throw new RangeError("The work coordinate slot must be 1 to 6");
    await this.sendLine(`G10 L20 P${slot} X0 Y0`);
  }

  // Runs the homing cycle ($H). The machine moves to its limit switches, so callers must confirm first.
  async home({ timeoutMs = 120000 } = {}) {
    if (this.busy) throw new Error("Cannot home while a machine job is running");
    await this.sendLine("$H", { timeoutMs });
  }

  get settings() {
    return Object.fromEntries([...this.grblSettings].map(([number, value]) => [`$${number}`, value]));
  }

  async querySettings() {
    if (this.busy) throw new Error("Cannot query controller settings while a machine job is running");
    this.grblSettings.clear();
    await this.sendLine("$$");
    return this.settings;
  }

  async queryStatus({ timeoutMs = 250 } = {}) {
    if (!this.serialPort.isOpen) throw new Error("Cannot query a closed serial connection");
    if (this.serialError) throw this.serialError;
    if (this.statusWaiter) throw new Error("A GRBL status query is already pending");
    this.status = null;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.statusWaiter?.timer === timer) {
          this.statusWaiter = null;
          resolve(null);
        }
      }, timeoutMs);
      this.statusWaiter = {
        timer,
        resolve: (status) => {
          clearTimeout(timer);
          this.statusWaiter = null;
          resolve(status);
        },
        reject: (error) => {
          clearTimeout(timer);
          this.statusWaiter = null;
          reject(error);
        }
      };
    });
    try {
      this.serialPort.write("?");
      await new Promise((resolve, reject) => this.serialPort.drain((error) => error ? reject(error) : resolve()));
    } catch (error) {
      this.statusWaiter?.reject(error);
    }
    return result;
  }

  async detectBaudRate(baudRates, { probeTimeoutMs = 300 } = {}) {
    if (this.busy) throw new Error("Cannot detect the serial baud rate while a machine job is running");
    if (!Array.isArray(baudRates) || baudRates.length === 0
      || baudRates.some((baudRate) => !Number.isSafeInteger(baudRate) || baudRate < 1200 || baudRate > 1000000)) {
      throw new TypeError("Baud rate candidates must be valid serial speeds");
    }
    for (const baudRate of baudRates) {
      await new Promise((resolve, reject) => {
        this.serialPort.update({ baudRate }, (error) => error ? reject(error) : resolve());
      });
      if (await this.queryStatus({ timeoutMs: probeTimeoutMs })) return baudRate;
    }
    return null;
  }

  rejectPending(error) {
    if (!this.pending) return;
    this.pending.reject(error);
  }

  async sendLine(line, { timeoutMs = this.acknowledgementTimeoutMs } = {}) {
    if (this.serialError) throw this.serialError;
    if (this.pending) throw new Error("A GRBL command is already awaiting acknowledgement");
    const result = new Promise((resolve, reject) => {
      // Counts time without progress: a full planner or a feed hold delays "ok" on purpose.
      const pending = {
        lastProgressAt: Date.now(),
        resolve: () => {
          clearInterval(pending.timer);
          this.pending = null;
          resolve();
        },
        reject: (error) => {
          clearInterval(pending.timer);
          this.pending = null;
          reject(error);
        },
        timer: null
      };
      pending.timer = setInterval(() => {
        if (this.pending !== pending) return;
        if (Date.now() - pending.lastProgressAt > timeoutMs) {
          pending.reject(new Error(`Timed out waiting for controller acknowledgement: ${line}`));
          return;
        }
        try {
          this.serialPort.write("?");
        } catch (error) {
          pending.reject(error);
        }
      }, watchdogIntervalMs(timeoutMs));
      this.pending = pending;
    });
    try {
      this.serialPort.write(`${line}\n`);
      await new Promise((resolve, reject) => this.serialPort.drain((error) => error ? reject(error) : resolve()));
      await result;
    } catch (error) {
      this.rejectPending(error);
      throw error;
    }
  }

  async sendJob(gcode) {
    if (this.busy) throw new Error("A machine job is already running");
    this.busy = true;
    this.cancelRequested = false;
    this.paused = false;
    this.programEnded = false;
    const lines = gcode.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    try {
      for (const [index, line] of lines.entries()) {
        await this.waitWhilePaused();
        if (this.cancelRequested) throw new Error(jobStoppedMessage);
        await this.sendLine(line);
        this.onProgress({ completed: index + 1, total: lines.length });
      }
      await this.waitForIdle();
    } catch (error) {
      if (this.cancelRequested) {
        try {
          await this.resetAfterStop();
        } catch (resetError) {
          throw new AggregateError([error, resetError], "Job stopped and the controller reset failed");
        }
        throw error;
      }
      try {
        this.serialPort.write("!");
      } catch (stopError) {
        throw new AggregateError([error, stopError], "Job failed and feed hold could not be sent");
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }

  async waitForIdle({ pollIntervalMs = 250, timeoutMs = 30 * 60 * 1000 } = {}) {
    const startedAt = Date.now();
    let idleReports = 0;
    while (Date.now() - startedAt < timeoutMs) {
      if (this.cancelRequested) throw new Error(jobStoppedMessage);
      if (this.serialError) throw this.serialError;
      this.serialPort.write("?");
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      if (this.status === "Idle") {
        idleReports += 1;
        if (idleReports === 2) return;
      } else if (this.programEnded && !/^(Run|Jog|Home|Hold)/.test(this.status ?? "")) {
        // "[MSG:Pgm End]" is sent after the planner drains, so a non-motion state means the job finished.
        return;
      } else {
        idleReports = 0;
        if (this.status === "Alarm" || this.status === "Door") {
          throw new Error(`Controller entered ${this.status} state`);
        }
      }
    }
    throw new Error("Timed out waiting for the controller to become idle");
  }

  async waitWhilePaused() {
    while (this.paused && !this.cancelRequested) {
      await new Promise((resolve) => {
        this.resumeWaiter = resolve;
      });
    }
  }

  wakeJob() {
    const wake = this.resumeWaiter;
    this.resumeWaiter = null;
    wake?.();
  }

  // Feed hold: the controller decelerates and keeps its buffered moves until resumed.
  pauseJob() {
    if (!this.busy) throw new Error("No machine job is currently running");
    if (this.paused || this.cancelRequested) return;
    this.paused = true;
    this.serialPort.write("!");
  }

  resumeJob() {
    if (!this.busy) throw new Error("No machine job is currently running");
    if (!this.paused) return;
    this.paused = false;
    this.serialPort.write("~");
    this.wakeJob();
  }

  stopJob() {
    if (!this.busy) throw new Error("No machine job is currently running");
    if (this.cancelRequested) return;
    this.cancelRequested = true;
    this.paused = false;
    this.serialPort.write("!");
    this.pending?.reject(new Error(jobStoppedMessage));
    this.wakeJob();
  }

  // Soft reset flushes the controller's buffer; it is sent only once the machine reports hold or idle.
  async resetAfterStop({ timeoutMs = 5000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.queryStatus({ timeoutMs: 250 });
      if (status && /^(Idle|Hold)/.test(status)) {
        this.serialPort.write("\x18");
        await new Promise((resolve, reject) => this.serialPort.drain((error) => error ? reject(error) : resolve()));
        return;
      }
    }
    throw new Error("The controller did not reach feed hold; soft reset was not sent");
  }

  async close() {
    if (this.busy) throw new Error("Cannot disconnect while a machine job is running; request feed hold first");
    this.statusWaiter?.reject(new Error("Serial connection closed during a status query"));
    this.serialPort.off("data", this.handleData);
    this.serialPort.off("error", this.handleError);
    if (this.serialPort.isOpen) {
      await new Promise((resolve, reject) => this.serialPort.close((error) => error ? reject(error) : resolve()));
    }
  }
}
