import { renderGrblJob } from "../core/document.js";
import { GrblConnection, verifyDynamicLaserMode } from "./grbl.js";

const baudCandidates = [115200, 230400, 57600, 250000];

export function isNativeApp() {
  return Boolean(globalThis.Capacitor?.isNativePlatform?.());
}

// Serial port object that GrblConnection drives, backed by the native USB serial plugin.
class NativeSerialPort {
  isOpen = true;
  writeChain = Promise.resolve();
  writeError = null;
  listeners = { data: new Set(), error: new Set(), close: new Set() };
  handles = [];

  constructor(plugin) {
    this.plugin = plugin;
  }

  on(event, listener) {
    this.listeners[event].add(listener);
    return this;
  }

  off(event, listener) {
    this.listeners[event].delete(listener);
    return this;
  }

  emit(event, value) {
    for (const listener of this.listeners[event]) listener(value);
  }

  async listen() {
    this.handles.push(await this.plugin.addListener("data", ({ data }) => this.emit("data", data)));
    this.handles.push(await this.plugin.addListener("error", ({ message }) => this.emit("error", new Error(message))));
  }

  releaseListeners() {
    this.isOpen = false;
    for (const handle of this.handles.splice(0)) handle.remove();
  }

  // Writes are queued so their order matches GRBL's command stream.
  write(data) {
    this.writeChain = this.writeChain
      .then(() => this.plugin.write({ data: String(data) }))
      .catch((error) => {
        this.writeError = error;
        this.emit("error", error);
      });
  }

  drain(callback) {
    this.writeChain.then(() => {
      const error = this.writeError;
      this.writeError = null;
      callback(error);
    });
  }

  update({ baudRate }, callback) {
    this.plugin.update({ baudRate }).then(() => callback?.(null), (error) => callback?.(error));
  }

  close(callback) {
    this.plugin.close().then(() => {
      this.releaseListeners();
      callback?.(null);
    }, (error) => callback?.(error));
  }
}

// Routes the same JSON contract as the desktop server (server.mjs) so the editor UI works unchanged on native builds.
export function createNativeMachineApi({ plugin = globalThis.Capacitor?.Plugins?.UsbSerial } = {}) {
  let connection = null;
  let activeJob = false;
  let jobTask = null;
  let connectionCleanup = null;
  let jobStatus = { state: "idle", completed: 0, total: 0, error: null };

  function requirePlugin() {
    if (!plugin) throw new Error("O plugin USB serial não está disponível neste aplicativo.");
    return plugin;
  }

  function createConnection(port) {
    const current = new GrblConnection(port, {
      onProgress: ({ completed, total }) => {
        jobStatus = { ...jobStatus, completed, total };
      },
      onDisconnect: () => {
        if (connection !== current) return;
        connection = null;
        const task = jobTask;
        connectionCleanup = (async () => {
          if (task) await task;
          await current.close();
        })().catch((error) => console.error(`Unable to release disconnected controller: ${error.message}`))
          .finally(() => { connectionCleanup = null; });
      }
    });
    return current;
  }

  async function openPort(path, baudRate) {
    const serialPort = new NativeSerialPort(requirePlugin());
    await serialPort.listen();
    try {
      await plugin.open({ path, baudRate });
    } catch (error) {
      serialPort.releaseListeners();
      throw error;
    }
    return serialPort;
  }

  async function queryControllerSettings(currentConnection) {
    try {
      const settings = await currentConnection.querySettings();
      if (typeof settings.$30 !== "number" || !Number.isFinite(settings.$30) || settings.$30 <= 0) {
        return { settings, settingsError: "A controladora respondeu, mas não informou um valor $30 válido." };
      }
      return { settings, settingsError: null };
    } catch (error) {
      return {
        settings: currentConnection.settings,
        settingsRead: false,
        settingsError: `Não foi possível consultar as configurações GRBL: ${error.message}`
      };
    }
  }

  async function connect(input) {
    if (connectionCleanup) await connectionCleanup;
    if (connection) throw new Error("Disconnect the current controller before connecting another");
    if (activeJob) throw new Error("Wait for the previous job to stop before connecting");
    if (typeof input.path !== "string" || !input.path) throw new TypeError("A serial port path is required");
    const detectBaud = input.baudRate === "auto";
    const baudRate = detectBaud ? baudCandidates[0] : Number(input.baudRate);
    if (!detectBaud && (!Number.isSafeInteger(baudRate) || baudRate < 1200 || baudRate > 1000000)) {
      throw new RangeError("Baud rate must be an integer between 1200 and 1000000");
    }
    const current = createConnection(await openPort(input.path, baudRate));
    try {
      if (detectBaud) {
        const detectedBaudRate = await current.detectBaudRate(baudCandidates);
        if (!detectedBaudRate) throw new Error("Não foi possível detectar o baud. Selecione manualmente uma velocidade e tente novamente.");
        connection = current;
        const { settings, settingsError } = await queryControllerSettings(current);
        if (connection !== current) throw new Error("Serial connection closed while connecting");
        return { connected: true, path: input.path, baudRate: detectedBaudRate, autoDetected: true, settings, settingsError };
      }
      connection = current;
      const { settings, settingsError } = await queryControllerSettings(current);
      if (connection !== current) throw new Error("Serial connection closed while connecting");
      return { connected: true, path: input.path, baudRate, autoDetected: false, settings, settingsError };
    } catch (error) {
      if (connectionCleanup) await connectionCleanup;
      else if (connection !== current) await current.close();
      throw error;
    }
  }

  async function listPorts() {
    const { ports } = await requirePlugin().list();
    return { ports, warning: null };
  }

  async function startJob(input) {
    if (!connection) throw new Error("Connect to a GRBL-compatible controller first");
    if (activeJob) throw new Error("A machine job is already running");
    connection.assertReadyForJob();
    if (input.safetyConfirmed !== true) throw new Error("Confirm the laser safety checklist before sending a job");
    const gcode = renderGrblJob(input.document, input.settings);
    activeJob = true;
    const jobConnection = connection;
    try {
      if ((input.settings.laserPowerMode ?? "M4") === "M4") {
        await verifyDynamicLaserMode(jobConnection);
        if (connection !== jobConnection) throw new Error("Serial connection closed while verifying laser mode");
      }
    } catch (error) {
      activeJob = false;
      throw error;
    }
    const total = gcode.trim().split(/\r?\n/).length;
    jobStatus = { state: "running", completed: 0, total, error: null };
    jobTask = jobConnection.sendJob(gcode).then(() => {
      jobStatus = { ...jobStatus, state: "complete" };
    }, (error) => {
      jobStatus = { ...jobStatus, state: "stopped", error: error.message };
    }).finally(() => {
      activeJob = false;
      jobTask = null;
    });
    return { accepted: true, lines: total };
  }

  function requireConnection(message) {
    if (!connection) throw new Error(message);
    return connection;
  }

  function requireIdle(message) {
    if (activeJob) throw new Error(message);
  }

  return async function machineRequest(path, method = "GET", body = {}) {
    switch (`${method} ${path}`) {
      case "GET /api/ports":
        return listPorts();
      case "GET /api/connection-status":
        return {
          connected: Boolean(connection),
          simulated: false,
          busy: activeJob,
          resetFailed: Boolean(connection?.resetFailed),
          settings: connection?.settings ?? null,
          jobStatus
        };
      case "POST /api/connect":
        return connect(body);
      case "POST /api/disconnect": {
        if (!connection) throw new Error("No controller is connected");
        if (activeJob) throw new Error("Stop the running job before disconnecting");
        const current = connection;
        await current.close();
        connection = null;
        return { connected: false };
      }
      case "POST /api/settings": {
        const current = requireConnection("Conecte uma controladora GRBL para consultar as configurações.");
        requireIdle("Não é possível consultar configurações durante o envio de um trabalho.");
        return queryControllerSettings(current);
      }
      case "POST /api/job":
        return startJob(body);
      case "GET /api/job-status":
        if (activeJob) connection?.requestStatusReport();
        return { ...jobStatus, resetFailed: Boolean(connection?.resetFailed), position: connection?.position?.work ?? null, report: connection?.report ?? null };
      case "POST /api/job-pause":
        if (!connection || !activeJob || !jobTask) throw new Error("No machine job is running");
        connection.pauseJob();
        jobStatus = { ...jobStatus, state: "paused" };
        return { paused: true };
      case "POST /api/job-resume":
        if (!connection || !activeJob || !jobTask) throw new Error("No machine job is running");
        connection.resumeJob();
        jobStatus = { ...jobStatus, state: "running" };
        return { resumed: true };
      case "POST /api/job-stop":
        if (!connection || !activeJob || !jobTask) throw new Error("No machine job is running");
        connection.stopJob();
        return { stopRequested: true };
      case "GET /api/position":
        requireIdle("Não é possível ler a posição durante o envio de um trabalho.");
        return requireConnection("Conecte uma controladora GRBL para ler a posição.").readPosition();
      case "POST /api/set-zero": {
        const current = requireConnection("Conecte uma controladora GRBL para definir o zero.");
        requireIdle("Não é possível definir o zero durante o envio de um trabalho.");
        const slot = body.slot ?? 1;
        await current.setZeroHere(slot);
        return { zeroSet: true, slot };
      }
      case "POST /api/home": {
        const current = requireConnection("Conecte uma controladora GRBL para fazer o homing.");
        requireIdle("Não é possível fazer homing durante o envio de um trabalho.");
        if (body.confirmed !== true) throw new Error("Confirme que a máquina pode se mover até os fins de curso antes do homing.");
        await current.home();
        return { homed: true };
      }
      default:
        throw new Error(`Endpoint não disponível no aplicativo: ${method} ${path}`);
    }
  };
}
