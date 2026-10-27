export class GrblConnection {
  constructor(serialPort, { acknowledgementTimeoutMs = 10000, onProgress = () => {} } = {}) {
    this.serialPort = serialPort;
    this.acknowledgementTimeoutMs = acknowledgementTimeoutMs;
    this.onProgress = onProgress;
    this.buffer = "";
    this.pending = null;
    this.busy = false;
    this.cancelRequested = false;
    this.status = null;
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
      if (response.startsWith("<") && response.includes(">")) {
        this.status = response.slice(1, response.indexOf(">")).split("|", 1)[0];
      } else if (/^ALARM:/i.test(response)) {
        this.rejectPending(new Error(`Controller alarm: ${response}`));
      } else if (/^error:/i.test(response)) {
        this.rejectPending(new Error(`Controller rejected command: ${response}`));
      } else if (/^ok$/i.test(response)) {
        this.pending?.resolve();
      }
    }
  }

  rejectPending(error) {
    if (!this.pending) return;
    this.pending.reject(error);
  }

  async sendLine(line) {
    if (this.serialError) throw this.serialError;
    if (this.pending) throw new Error("A GRBL command is already awaiting acknowledgement");
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.timer === timer) {
          this.pending = null;
          reject(new Error(`Timed out waiting for controller acknowledgement: ${line}`));
        }
      }, this.acknowledgementTimeoutMs);
      this.pending = {
        resolve: () => {
          clearTimeout(timer);
          this.pending = null;
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          this.pending = null;
          reject(error);
        },
        timer
      };
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
    const lines = gcode.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    try {
      for (const [index, line] of lines.entries()) {
        if (this.cancelRequested) throw new Error("Job stopped; controller is in feed hold");
        await this.sendLine(line);
        this.onProgress({ completed: index + 1, total: lines.length });
      }
      await this.waitForIdle();
    } catch (error) {
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
      if (this.cancelRequested) throw new Error("Job stopped; controller is in feed hold");
      if (this.serialError) throw this.serialError;
      this.serialPort.write("?");
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      if (this.status === "Idle") {
        idleReports += 1;
        if (idleReports === 2) return;
      } else {
        idleReports = 0;
        if (this.status === "Alarm" || this.status === "Door") {
          throw new Error(`Controller entered ${this.status} state`);
        }
      }
    }
    throw new Error("Timed out waiting for the controller to become idle");
  }

  feedHold() {
    if (!this.busy) throw new Error("No machine job is currently running");
    this.cancelRequested = true;
    this.serialPort.write("!");
    this.pending?.reject(new Error("Job stopped; controller is in feed hold"));
  }

  async close() {
    if (this.busy) throw new Error("Cannot disconnect while a machine job is running; request feed hold first");
    this.serialPort.off("data", this.handleData);
    this.serialPort.off("error", this.handleError);
    if (this.serialPort.isOpen) {
      await new Promise((resolve, reject) => this.serialPort.close((error) => error ? reject(error) : resolve()));
    }
  }
}
