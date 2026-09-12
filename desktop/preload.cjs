const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nativeAudio', {
  playWavBase64: (base64) => ipcRenderer.invoke('native-audio:play-wav', base64),
  stop: () => ipcRenderer.invoke('native-audio:stop'),
});
