const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("minaControl", {
  status: () => ipcRenderer.invoke("mina:status"),
  start: () => ipcRenderer.invoke("mina:start"),
  stop: () => ipcRenderer.invoke("mina:stop"),
  restart: () => ipcRenderer.invoke("mina:restart"),
});
