const { contextBridge, ipcRenderer } = require('electron');

// Keep the RVC bridge deliberately small and clone-safe. Everything crossing
// the renderer boundary is a string, number, boolean, or plain object.
contextBridge.exposeInMainWorld('voicechangerRvc', Object.freeze({
  convertWav: (base64Wav, options = {}) => ipcRenderer.invoke('rvc:convert-wav', {
    base64Wav: String(base64Wav || ''),
    options: {
      voiceId: String(options?.voiceId || 'default'),
      retrievalBlend: Number(options?.retrievalBlend || 0)
    }
  }),
  ensureModel: () => ipcRenderer.invoke('rvc:ensure-model'),
  getStatus: () => ipcRenderer.invoke('rvc:status'),
  stop: () => ipcRenderer.invoke('rvc:stop')
}));
