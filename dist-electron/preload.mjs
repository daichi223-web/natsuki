"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  on(channel, callback) {
    const subscription = (_event, ...args) => callback(...args);
    electron.ipcRenderer.on(channel, subscription);
    return () => electron.ipcRenderer.removeListener(channel, subscription);
  },
  send(channel, ...args) {
    electron.ipcRenderer.send(channel, ...args);
  },
  invoke(channel, ...args) {
    return electron.ipcRenderer.invoke(channel, ...args);
  },
  removeAllListeners(channel) {
    electron.ipcRenderer.removeAllListeners(channel);
  }
});
