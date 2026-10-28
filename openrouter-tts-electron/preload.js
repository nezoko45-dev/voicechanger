const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ttsApp', {
  speak: (payload) => ipcRenderer.invoke('tts:speak', payload)
});