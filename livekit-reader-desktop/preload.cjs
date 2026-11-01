const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('voiceReader', {
 saveCredentials: data => ipcRenderer.invoke('credentials:save', data),
 credentialsStatus: () => ipcRenderer.invoke('credentials:status'),
 clearCredentials: () => ipcRenderer.invoke('credentials:clear'),
 synthesize: data => ipcRenderer.invoke('tts:synthesize', data)
});
