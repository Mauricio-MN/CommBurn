import { app, BrowserWindow, shell } from "electron";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { startServer } from "./server.mjs";

let serverHandle;
let mainWindow;
let isClosing = false;

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