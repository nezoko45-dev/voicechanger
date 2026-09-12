const NativeWebSocket = window.WebSocket;

function proxyUrlFor(deepgramUrl) {
  const nativeAudio = window.nativeAudio;
  if (!nativeAudio?.deepgramProxyUrl) return null;
  const proxyBase = nativeAudio.deepgramProxyUrl();
  if (!proxyBase) return null;
  try {
    const original = new URL(deepgramUrl);
    return `${proxyBase}${original.search}`;
  } catch {
    return null;
  }
}

class VoiceChangerWebSocket extends NativeWebSocket {
  constructor(url, protocols) {
    const isDeepgram = typeof url === 'string' && url.startsWith('wss://api.deepgram.com/');
    const proxyUrl = isDeepgram ? proxyUrlFor(url) : null;
    if (proxyUrl && Array.isArray(protocols) && protocols.length >= 2) {
      super(proxyUrl, ['voicechanger', protocols[1]]);
      return;
    }
    super(url, protocols);
  }
}

for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
  Object.defineProperty(VoiceChangerWebSocket, key, { value: NativeWebSocket[key] });
}

window.WebSocket = VoiceChangerWebSocket;
