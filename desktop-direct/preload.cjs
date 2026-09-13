const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voicechangerRvc', {
  convertWav: (base64Wav, options = {}) => ipcRenderer.invoke('rvc:convert-wav', { base64Wav, options }),
  ensureModel: () => ipcRenderer.invoke('rvc:ensure-model'),
  getStatus: () => ipcRenderer.invoke('rvc:status')
});
