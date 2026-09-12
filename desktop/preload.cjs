const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('deepgram:event', (_event, payload) => {
  for (const fn of listeners) {
    try { fn(payload); } catch {}
  }
});

contextBridge.exposeInMainWorld('nativeAudio', {
  playWavBase64: (base64) => ipcRenderer.invoke('native-audio:play-wav', base64),
  stop: () => ipcRenderer.invoke('native-audio:stop'),
  driverStatus: () => ipcRenderer.invoke('voicechanger-driver:status'),
  driverInstall: () => ipcRenderer.invoke('voicechanger-driver:install'),
  driverUninstall: () => ipcRenderer.invoke('voicechanger-driver:uninstall'),
});

contextBridge.exposeInMainWorld('nativeDeepgram', {
  connect: (url, protocols) => {
    const id = Math.floor(Math.random() * 0x7fffffff);
    ipcRenderer.send('deepgram:connect', { url, protocols, clientId: id });
    return id;
  },
  // Electron IPC's structured-clone boundary can reject renderer ArrayBuffer
  // objects in some packaged Electron builds. Send plain integer arrays instead.
  send: (id, data) => {
    let bytes;
    if (data instanceof ArrayBuffer) bytes = Array.from(new Uint8Array(data));
    else if (ArrayBuffer.isView(data)) bytes = Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    else if (Array.isArray(data)) bytes = data;
    else throw new TypeError('Deepgram audio payload must be binary audio data.');
    ipcRenderer.send('deepgram:send', { id, data: bytes });
  },
  close: (id, code, reason) => ipcRenderer.send('deepgram:close', { id, code, reason }),
  addListener: (fn) => listeners.add(fn),
  removeListener: (fn) => listeners.delete(fn),
});
