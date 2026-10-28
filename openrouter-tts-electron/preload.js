const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ttsApp', {
  speak: (payload) => ipcRenderer.invoke('tts:speak', payload),
  startDictation: () => ipcRenderer.invoke('dictation:start'),
  stopDictation: () => ipcRenderer.invoke('dictation:stop'),
  onDictationEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('dictation:event', listener);
    return () => ipcRenderer.removeListener('dictation:event', listener);
  }
});
