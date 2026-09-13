const { contextBridge, ipcRenderer } = require('electron');

const eventQueue = [];
const MAX_QUEUE = 500;

ipcRenderer.on('deepgram:event', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return;
  const safe = { id: Number.isInteger(payload.id) ? payload.id : 0, type: typeof payload.type === 'string' ? payload.type : '' };
  if (typeof payload.data === 'string') safe.data = payload.data;
  if (typeof payload.protocol === 'string') safe.protocol = payload.protocol;
  if (typeof payload.message === 'string') safe.message = payload.message;
  if (typeof payload.reason === 'string') safe.reason = payload.reason;
  if (Number.isFinite(payload.code)) safe.code = Number(payload.code);
  if (typeof payload.wasClean === 'boolean') safe.wasClean = payload.wasClean;
  eventQueue.push(safe);
  if (eventQueue.length > MAX_QUEUE) eventQueue.splice(0, eventQueue.length - MAX_QUEUE);
});

function openVoiceGenerate(payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('OpenVoice request must be an object.');
  return ipcRenderer.invoke('openvoice:generate', {
    referenceBase64: String(payload.referenceBase64 || ''),
    referenceName: String(payload.referenceName || 'reference.wav'),
    text: String(payload.text || ''),
  });
}

contextBridge.exposeInMainWorld('nativeAudio', {
  playWavBase64: (base64) => ipcRenderer.invoke('native-audio:play-wav', String(base64 || '')),
  stop: () => ipcRenderer.invoke('native-audio:stop'),
  driverStatus: () => ipcRenderer.invoke('voicechanger-driver:status'),
  driverInstall: () => ipcRenderer.invoke('voicechanger-driver:install'),
  driverUninstall: () => ipcRenderer.invoke('voicechanger-driver:uninstall'),
});

contextBridge.exposeInMainWorld('openVoiceTTS', { generate: openVoiceGenerate });
contextBridge.exposeInMainWorld('f5TTS', { generate: openVoiceGenerate });

contextBridge.exposeInMainWorld('nativeDeepgram', {
  connect: (url, protocols) => {
    const id = Math.floor(Math.random() * 0x7fffffff);
    ipcRenderer.send('deepgram:connect', { url: String(url || ''), protocols: Array.isArray(protocols) ? protocols.map(String) : [], clientId: id });
    return id;
  },
  send: (id, data) => {
    let bytes;
    if (data instanceof ArrayBuffer) bytes = Array.from(new Uint8Array(data));
    else if (ArrayBuffer.isView(data)) bytes = Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    else if (Array.isArray(data)) bytes = data.map(Number);
    else throw new TypeError('Deepgram audio payload must be binary audio data.');
    ipcRenderer.send('deepgram:send', { id: Number(id), data: bytes });
  },
  close: (id, code, reason) => ipcRenderer.send('deepgram:close', { id: Number(id), code: Number(code) || 1000, reason: String(reason || '') }),
  poll: () => eventQueue.splice(0, eventQueue.length),
});
