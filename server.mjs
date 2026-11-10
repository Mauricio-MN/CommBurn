import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { lstat, readFile, readdir } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SerialPort } from "serialport";
import { renderGrblJob } from "./src/core/document.js";
import { GrblConnection } from "./src/machine/grbl.js";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const host = "127.0.0.1";
const portNumber = Number(process.env.PORT ?? 4173);
let connection = null;
let activeJob = false;
let jobTask = null;
let jobStatus = { state: "idle", completed: 0, total: 0, error: null };
let desktopPluginDirectory = null;

class SimulatedSerialPort extends EventEmitter {
  isOpen = true;
  status = "Idle";

  write(data) {
    setTimeout(() => {
      if (data === "?") {
        this.emit("data", Buffer.from(`<${this.status}|MPos:0,0,0>\r\n`));
      } else if (data === "!") {
        this.status = "Hold:0";
        this.emit("data", Buffer.from(`<${this.status}|MPos:0,0,0>\r\n`));
      } else if (data.endsWith("\n")) {
        this.emit("data", Buffer.from("ok\r\n"));
      }
    }, 2);
  }

  drain(callback) {
    callback(null);
  }

  close(callback) {
    this.isOpen = false;
    callback(null);
  }
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

const pluginIdPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
const pluginLocales = new Set(["en", "pt-BR"]);
const pluginLocaleSizeLimit = 256 * 1024;

function isMessageCatalog(value, depth = 0) {
  if (typeof value === "string") return true;
  if (!value || typeof value !== "object" || Array.isArray(value) || depth >= 8) return false;
  const entries = Object.entries(value);
  return entries.every(([key, child]) => /^[\w.-]{1,100}$/.test(key) && isMessageCatalog(child, depth + 1));
}

async function readDesktopPlugin(id) {
  if (!desktopPluginDirectory || !pluginIdPattern.test(id)) return null;
  const pluginDirectory = resolve(desktopPluginDirectory, id);
  try {
    if (!(await lstat(pluginDirectory)).isDirectory()) return null;
    const manifestPath = resolve(pluginDirectory, "manifest.json");
    if (!(await lstat(manifestPath)).isFile()) return null;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.id !== id
      || manifest.apiVersion !== 1
      || manifest.entry !== "plugin.mjs"
      || typeof manifest.name !== "string"
      || !manifest.name.trim()
      || manifest.name.length > 80
      || typeof manifest.version !== "string"
      || !manifest.version.trim()
      || manifest.version.length > 64) return null;
    const entryPath = resolve(pluginDirectory, "plugin.mjs");
    if (!(await lstat(entryPath)).isFile()) return null;
    const localeUrls = {};
    const localePaths = {};
    const declaredLocales = manifest.locales ?? {};
    if (!declaredLocales || typeof declaredLocales !== "object" || Array.isArray(declaredLocales)) return null;
    const localeDirectory = resolve(pluginDirectory, "locales");
    if (Object.keys(declaredLocales).length > 0 && !(await lstat(localeDirectory)).isDirectory()) return null;
    for (const [locale, relativePath] of Object.entries(declaredLocales)) {
      if (!pluginLocales.has(locale) || relativePath !== `locales/${locale}.json`) return null;
      const localePath = resolve(pluginDirectory, relativePath);
      if (!localePath.startsWith(`${pluginDirectory}${sep}`)) return null;
      const localeFile = await lstat(localePath);
      if (!localeFile.isFile() || localeFile.size > pluginLocaleSizeLimit) return null;
      const messages = JSON.parse(await readFile(localePath, "utf8"));
      if (!isMessageCatalog(messages)) return null;
      localeUrls[locale] = `/desktop-plugins/${id}/locales/${locale}.json`;
      localePaths[locale] = localePath;
    }
    return {
      id,
      name: manifest.name,
      version: manifest.version,
      apiVersion: 1,
      url: `/desktop-plugins/${id}/plugin.mjs`,
      localeUrls,
      entryPath,
      localePaths
    };
  } catch {
    return null;
  }
}

async function listDesktopPlugins() {
  if (!desktopPluginDirectory) return [];
  let entries;
  try {
    entries = await readdir(desktopPluginDirectory, { withFileTypes: true });
  } catch {
    return [];
  }
  const plugins = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const plugin = await readDesktopPlugin(entry.name);
    if (!plugin) continue;
    const { entryPath, localePaths, ...metadata } = plugin;
    plugins.push(metadata);
  }
  return plugins;
}

function createGrblConnection(serialPort) {
  return new GrblConnection(serialPort, {
    onProgress: ({ completed, total }) => {
      jobStatus = { ...jobStatus, completed, total };
    }
  });
}

function attachConnection(serialPort, simulated = false, existingConnection = null) {
  connection = existingConnection ?? createGrblConnection(serialPort);
  connection.isSimulation = simulated;
  return connection;
}

async function queryControllerSettings(currentConnection) {
  try {
    const settings = await currentConnection.querySettings();
    if (typeof settings.$30 !== "number" || !Number.isFinite(settings.$30) || settings.$30 <= 0) {
      return {
        settings,
        settingsError: "A controladora respondeu, mas não informou um valor $30 válido."
      };
    }
    return { settings, settingsError: null };
  } catch (error) {
    return {
      settings: currentConnection.settings,
      settingsError: `Não foi possível consultar as configurações GRBL: ${error.message}`
    };
  }
}

function verifyLocalRequest(request, response) {
  const origin = request.headers.origin;
  const hostHeader = request.headers.host;
  if (!["127.0.0.1", "localhost"].includes((hostHeader ?? "").split(":")[0])) {
    sendJson(response, 403, { error: "CommBurn accepts local connections only" });
    return false;
  }
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      sendJson(response, 403, { error: "Cross-origin machine access is not allowed" });
      return false;
    }
    if (originHost !== hostHeader) {
      sendJson(response, 403, { error: "Cross-origin machine access is not allowed" });
      return false;
    }
  }
  return true;
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new RangeError("Request body is too large");
  }
  return JSON.parse(body);
}

export async function listSerialPorts(listPorts = () => SerialPort.list()) {
  try {
    return { ports: await listPorts(), warning: null };
  } catch (error) {
    const missingUdevadm = error?.code === "ENOENT"
      && (error?.path === "udevadm" || error?.message?.includes("spawn udevadm ENOENT"));
    if (!missingUdevadm) throw error;
    return {
      ports: [],
      warning: "A lista automática de portas não está disponível neste Linux. Você ainda pode digitar o caminho da porta manualmente."
    };
  }
}

async function handleApi(request, response, url) {
  if (!verifyLocalRequest(request, response)) return;
  try {
    if (request.method === "GET" && url.pathname === "/api/plugins") {
      sendJson(response, 200, { plugins: await listDesktopPlugins() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/connection-status") {
      sendJson(response, 200, {
        connected: Boolean(connection),
        simulated: Boolean(connection?.isSimulation),
        busy: activeJob,
        settings: connection?.settings ?? null,
        jobStatus
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/ports") {
      sendJson(response, 200, await listSerialPorts());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/connect") {
      if (connection) throw new Error("Disconnect the current controller before connecting another");
      const input = await readJson(request);
      if (typeof input.path !== "string" || !input.path) throw new TypeError("A serial port path is required");
      const baudCandidates = [115200, 230400, 57600, 250000];
      const detectBaud = input.baudRate === "auto";
      const baudRate = detectBaud ? baudCandidates[0] : Number(input.baudRate);
      if (!detectBaud && (!Number.isSafeInteger(baudRate) || baudRate < 1200 || baudRate > 1000000)) {
        throw new RangeError("Baud rate must be an integer between 1200 and 1000000");
      }
      const serialPort = new SerialPort({ path: input.path, baudRate, autoOpen: false });
      await new Promise((resolveOpen, rejectOpen) => serialPort.open((error) => error ? rejectOpen(error) : resolveOpen()));
      let currentConnection;
      if (detectBaud) {
        currentConnection = createGrblConnection(serialPort);
        try {
          const detectedBaudRate = await currentConnection.detectBaudRate(baudCandidates);
          if (!detectedBaudRate) {
            await currentConnection.close();
            throw new Error("Não foi possível detectar o baud. Selecione manualmente uma velocidade e tente novamente.");
          }
          currentConnection = attachConnection(serialPort, false, currentConnection);
          const { settings, settingsError } = await queryControllerSettings(currentConnection);
          sendJson(response, 200, {
            connected: true,
            path: input.path,
            baudRate: detectedBaudRate,
            autoDetected: true,
            settings,
            settingsError
          });
          return;
        } catch (error) {
          if (connection !== currentConnection && serialPort.isOpen) await currentConnection.close();
          throw error;
        }
      }
      currentConnection = attachConnection(serialPort);
      const { settings, settingsError } = await queryControllerSettings(currentConnection);
      sendJson(response, 200, { connected: true, path: input.path, baudRate, autoDetected: false, settings, settingsError });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/simulate-connect") {
      if (connection) throw new Error("Desconecte o controlador atual antes de conectar o simulador");
      attachConnection(new SimulatedSerialPort(), true);
      sendJson(response, 200, { connected: true, simulated: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/disconnect") {
      if (!connection) throw new Error("No controller is connected");
      if (activeJob) throw new Error("Stop the running job before disconnecting");
      const current = connection;
      await current.close();
      connection = null;
      sendJson(response, 200, { connected: false });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/settings") {
      if (!connection) throw new Error("Conecte uma controladora GRBL para consultar as configurações.");
      if (connection.isSimulation) throw new Error("O simulador não tem configurações de uma máquina real.");
      if (activeJob) throw new Error("Não é possível consultar configurações durante o envio de um trabalho.");
      const { settings, settingsError } = await queryControllerSettings(connection);
      sendJson(response, 200, { settings, settingsError });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/hold") {
      if (!connection) throw new Error("No controller is connected");
      connection.feedHold();
      sendJson(response, 200, { holdRequested: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/job-status") {
      sendJson(response, 200, jobStatus);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/job") {
      if (!connection) throw new Error("Connect to a GRBL-compatible controller first");
      if (activeJob) throw new Error("A machine job is already running");
      const input = await readJson(request);
      if (!connection.isSimulation && input.safetyConfirmed !== true) {
        throw new Error("Confirm the laser safety checklist before sending a job");
      }
      const gcode = renderGrblJob(input.document, input.settings);
      activeJob = true;
      const jobConnection = connection;
      const total = gcode.trim().split(/\r?\n/).length;
      jobStatus = { state: "running", completed: 0, total, error: null };
      sendJson(response, 202, { accepted: true, lines: total });
      jobTask = jobConnection.sendJob(gcode).then(() => {
        jobStatus = { ...jobStatus, state: "complete" };
      }, (error) => {
        jobStatus = { ...jobStatus, state: "stopped", error: error.message };
      }).finally(() => {
        activeJob = false;
        jobTask = null;
      });
      return;
    }
    sendJson(response, 404, { error: "API endpoint not found" });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }
  if (url.pathname.startsWith("/desktop-plugins/")) {
    const match = /^\/desktop-plugins\/([a-z0-9][a-z0-9-]{0,62})\/(plugin\.mjs|locales\/(en|pt-BR)\.json)$/.exec(url.pathname);
    const plugin = match ? await readDesktopPlugin(match[1]) : null;
    if (!plugin) {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      const locale = match[3];
      const filePath = locale ? plugin.localePaths[locale] : plugin.entryPath;
      if (!filePath) {
        response.writeHead(404).end("Not found");
        return;
      }
      const content = await readFile(filePath);
      response.writeHead(200, {
        ...securityHeaders,
        "Content-Type": locale ? "application/json; charset=utf-8" : contentTypes[".mjs"],
        "Cache-Control": "no-store"
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch {
      response.writeHead(404).end("Not found");
    }
    return;
  }
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  if (requestedPath !== "/index.html"
    && requestedPath !== "/commburn-icon.svg"
    && requestedPath !== "/vendor/svgson.js"
    && requestedPath !== "/src/core/hershey-fonts.json"
    && !/^\/src\/[a-zA-Z0-9_/-]+\.(?:js|css)$/.test(requestedPath)
    && !/^\/node_modules\/svg-pathdata\/lib\/[a-zA-Z0-9_.-]+\.js$/.test(requestedPath)
    && requestedPath !== "/node_modules/@jodit/image-editor/dist/jodit-image-editor.js"
    && requestedPath !== "/node_modules/imagetracerjs/imagetracer_v1.2.6.js") {
    response.writeHead(404).end("Not found");
    return;
  }
  const filePath = requestedPath === "/vendor/svgson.js"
    ? resolve(root, "node_modules/svgson/dist/svgson.umd.js")
    : resolve(root, `.${requestedPath}`);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { ...securityHeaders, "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
  }
});

export function startServer({ port = portNumber, pluginDirectory = null } = {}) {
  desktopPluginDirectory = pluginDirectory;
  return new Promise((resolveStart, rejectStart) => {
    const onError = (error) => {
      server.off("listening", onListening);
      rejectStart(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      resolveStart({ url: `http://${host}:${address.port}`, close: shutdown });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function shutdown() {
  if (connection) {
    if (activeJob) {
      try {
        connection.feedHold();
      } catch (error) {
        console.error(`Unable to request feed hold: ${error.message}`);
      }
      await jobTask;
    }
    try { await connection.close(); } catch (error) { console.error(`Unable to close controller cleanly: ${error.message}`); }
  }
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  const { url } = await startServer();
  console.log(`CommBurn running at ${url}`);
}
