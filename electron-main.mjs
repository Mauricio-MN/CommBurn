import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { cp, mkdir, readdir, access, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.mjs";

const PROJECT_SAVE_LIMIT_BYTES = 50 * 1024 * 1024;
const savedProjectPaths = new Set();
let unsavedTexts = null;

ipcMain.on("commburn:unsaved-changes", (event, state) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  unsavedTexts = state?.dirty
    ? { message: String(state.message), leave: String(state.leave), stay: String(state.stay) }
    : null;
});

let serverHandle;
let mainWindow;
let isClosing = false;

ipcMain.handle("commburn:save-project", async (event, request) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error("Origem de salvamento não confiável.");
  if (typeof request?.contents !== "string" || Buffer.byteLength(request.contents) > PROJECT_SAVE_LIMIT_BYTES) {
    throw new RangeError("O projeto deve ter no máximo 50 MB.");
  }
  // Only paths returned by an earlier save dialog are reused, so the renderer cannot pick arbitrary files.
  let filePath = savedProjectPaths.has(request.filePath) ? request.filePath : null;
  if (!filePath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: basename(String(request.suggestedName ?? "Trabalho sem título.commburn.json")),
      filters: [{ name: "CommBurn", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return null;
    filePath = result.filePath;
  }
  await writeFile(filePath, request.contents, "utf8");
  savedProjectPaths.add(filePath);
  return filePath;
});

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
      sandbox: true,
      preload: fileURLToPath(new URL("./electron-preload.cjs", import.meta.url))
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
  // The renderer prevents unload while projects have unsaved edits; confirm before letting the window close.
  mainWindow.webContents.on("will-prevent-unload", (event) => {
    const texts = unsavedTexts ?? { message: "", leave: "OK", stay: "Cancel" };
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      message: texts.message,
      buttons: [texts.leave, texts.stay],
      defaultId: 1,
      cancelId: 1
    });
    if (choice === 0) event.preventDefault();
  });
  // Blob downloads make Chromium replace the window title with the blob URL.
  mainWindow.on("page-title-updated", (event) => event.preventDefault());
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
      Menu.setApplicationMenu(null);
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

  app.on("will-quit", (event) => {
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