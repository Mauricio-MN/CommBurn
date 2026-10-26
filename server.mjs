import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
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

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
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

async function handleApi(request, response, url) {
  if (!verifyLocalRequest(request, response)) return;
  try {
    if (request.method === "GET" && url.pathname === "/api/ports") {
      sendJson(response, 200, { ports: await SerialPort.list() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/connect") {
      if (connection) throw new Error("Disconnect the current controller before connecting another");
      const input = await readJson(request);
      if (typeof input.path !== "string" || !input.path) throw new TypeError("A serial port path is required");
      const baudRate = Number(input.baudRate);
      if (!Number.isSafeInteger(baudRate) || baudRate < 1200 || baudRate > 1000000) {
        throw new RangeError("Baud rate must be an integer between 1200 and 1000000");
      }
      const serialPort = new SerialPort({ path: input.path, baudRate, autoOpen: false });
      await new Promise((resolveOpen, rejectOpen) => serialPort.open((error) => error ? rejectOpen(error) : resolveOpen()));
      connection = new GrblConnection(serialPort, {
        onProgress: ({ completed, total }) => {
          jobStatus = { ...jobStatus, completed, total };
        }
      });
      sendJson(response, 200, { connected: true, path: input.path, baudRate });
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
      if (input.safetyConfirmed !== true) throw new Error("Confirm the laser safety checklist before sending a job");
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
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  if (requestedPath !== "/index.html"
    && requestedPath !== "/vendor/svgson.js"
    && !/^\/src\/[a-zA-Z0-9_/-]+\.(?:js|css)$/.test(requestedPath)
    && !/^\/node_modules\/svg-pathdata\/lib\/[a-zA-Z0-9_.-]+\.js$/.test(requestedPath)) {
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

server.listen(portNumber, host, () => console.log(`CommBurn running at http://${host}:${portNumber}`));

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
  server.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
