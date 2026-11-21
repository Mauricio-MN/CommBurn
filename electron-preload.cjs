const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("commburnDesktop", Object.freeze({
  saveProject: (request) => ipcRenderer.invoke("commburn:save-project", request),
  setUnsavedChanges: (state) => ipcRenderer.send("commburn:unsaved-changes", state)
}));
