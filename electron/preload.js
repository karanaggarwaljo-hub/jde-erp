const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('setup', {
  submit: (config) => ipcRenderer.invoke('submit-config', config),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onPrefill: (callback) => ipcRenderer.on('prefill', (_event, config) => callback(config)),
});
