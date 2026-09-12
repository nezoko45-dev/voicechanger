const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nativeAudio', {
  playWavBase64: (base64) => ipcRenderer.invoke('native-audio:play-wav', base64),
  stop: () => ipcRenderer.invoke('native-audio:stop'),
  driverStatus: () => ipcRenderer.invoke('voicechanger-driver:status'),
  driverInstall: () => ipcRenderer.invoke('voicechanger-driver:install'),
  driverUninstall: () => ipcRenderer.invoke('voicechanger-driver:uninstall'),
  deepgramProxyUrl: () => ipcRenderer.sendSync('deepgram-proxy:url'),
});
