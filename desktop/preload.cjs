const { contextBridge, ipcRenderer } = require('electron');

// Keep IPC values strictly structured-clone-safe. In particular, do not pass
// renderer callbacks/functions through contextBridge: some packaged Electron
// builds can throw "object could not be cloned" at that boundary.
const eventQueue = [];
const MAX_QUEUE = 500;

ipcRenderer.on('deepgram:event', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return;
  // Copy only primitive/array data that Electron can safely clone.
  const safe = {
    id: Number.isInteger(payload.id) ? payload.id : 0,
    type: typeof payload.type === 'string' ? payload.type : '',
  };
  if (typeof payload.data === 'string') safe.data = payload.data;
  if (typeof payload.protocol === 'string') safe.protocol = payload.protocol;
  if (typeof payload.message === 'string') safe.message = payload.message;
  if (typeof payload.reason === 'string') safe.reason = payload.reason;
  if (Number.isFinite(payload.code)) safe.code = Number(payload.code);
  if (typeof payload.wasClean === 'boolean') safe.wasClean = payload.wasClean;

  eventQueue.push(safe);
  if (eventQueue.length > MAX_QUEUE) eventQueue.splice(0, eventQueue.length - MAX_QUEUE);
});

contextBridge.exposeInMainWorld('nativeAudio', {
  playWavBase64: (base64) => ipcRenderer.invoke('native-audio:play-wav', String(base64 || '')),
  stop: () => ipcRenderer.invoke('native-audio:stop'),
  driverStatus: () => ipcRenderer.invoke('voicechanger-driver:status'),
  driverInstall: () => ipcRenderer.invoke('voicechanger-driver:install'),
  driverUninstall: () => ipcRenderer.invoke('voicechanger-driver:uninstall'),
});

contextBridge.exposeInMainWorld('nativeDeepgram', {
  connect: (url, protocols) => {
    const id = Math.floor(Math.random() * 0x7fffffff);
    const safeUrl = String(url || '');
    const safeProtocols = Array.isArray(protocols) ? protocols.map(String) : [];
    ipcRenderer.send('deepgram:connect', {
      url: safeUrl,
      protocols: safeProtocols,
      clientId: id,
    });
    return id;
  },

  // Send only plain integer arrays across Electron IPC. This avoids packaged
  // Electron structured-clone failures with renderer ArrayBuffer objects.
  send: (id, data) => {
    let bytes;
    if (data instanceof ArrayBuffer) {
      bytes = Array.from(new Uint8Array(data));
    } else if (ArrayBuffer.isView(data)) {
      bytes = Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } else if (Array.isArray(data)) {
      bytes = data.map(Number);
    } else {
      throw new TypeError('Deepgram audio payload must be binary audio data.');
    }
    ipcRenderer.send('deepgram:send', { id: Number(id), data: bytes });
  },

  close: (id, code, reason) => ipcRenderer.send('deepgram:close', {
    id: Number(id),
    code: Number(code) || 1000,
    reason: String(reason || ''),
  }),

  // Pull plain JSON-like events instead of passing renderer callback functions
  // through contextBridge. This is the important fix for "object cannot be cloned".
  poll: () => {
    if (eventQueue.length === 0) return [];
    return eventQueue.splice(0, eventQueue.length);
  },
});
