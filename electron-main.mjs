import { app, BrowserWindow, shell } from "electron";
import { cp, mkdir, readdir, access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startServer } from "./server.mjs";

let serverHandle;
let mainWindow;
let isClosing = false;

async function installBundledPlugins(pluginDirectory) {
  if (!app.isPackaged) return;
  const markerPath = join(app.getPath("userData"), "bundled-plugins-seeded");
  try {
    await access(markerPath);
    return;
  } catch {
    // First run: seed bundled plugins below.
  }
  const bundledDirectory = join(process.resourcesPath, "bundled-plugins");
  let entries;
  try {
    entries = await readdir(bundledDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = join(pluginDirectory, entry.name);
    try {
      await access(target);
      continue;
    } catch {
      await cp(join(bundledDirectory, entry.name), target, { recursive: true });
    }
  }
  await writeFile(markerPath, "");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    title: "CommBurn",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.setMenuBarVisibility(false);

  const trustedOrigin = new URL(serverHandle.url).origin;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== trustedOrigin) event.preventDefault();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow.loadURL(serverHandle.url);
}

if (app.requestSingleInstanceLock()) {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      app.setApplicationMenu(null);
      const pluginDirectory = join(app.getPath("userData"), "plugins");
      await mkdir(pluginDirectory, { recursive: true });
      try {
        await installBundledPlugins(pluginDirectory);
      } catch (error) {
        console.error(`Unable to install bundled plugins: ${error.message}`);
      }
      serverHandle = await startServer({ port: 0, pluginDirectory });
      await createWindow();
    } catch (error) {
      console.error(`Unable to start CommBurn: ${error.message}`);
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverHandle) void createWindow();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (!serverHandle || isClosing) return;
    event.preventDefault();
    isClosing = true;
    serverHandle.close().catch((error) => {
      console.error(`Unable to close CommBurn cleanly: ${error.message}`);
    }).finally(() => app.quit());
  });
} else {
  app.quit();
}