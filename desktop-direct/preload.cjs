const { ipcRenderer } = require('electron');

// VoiceChanger Direct is a local-only desktop app. Use a plain preload bridge
// so the RVC API is available directly to the renderer without contextBridge
// availability/serialization issues.
window.voicechangerRvc = Object.freeze({
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
});

window.voicechangerDesktop = true;
