// Deepgram connection stability + low-latency tuning.
// Loaded before main-fixed.js. Do not replace WebSocket constants/prototype
// properties; Electron treats some of them as read-only.
(() => {
  const NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket || window.__voiceChangerFastLatency) return;
  window.__voiceChangerFastLatency = true;

  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args) {
      let [url, protocols] = args;
      try {
        const parsed = new URL(String(url), window.location.href);
        if (parsed.hostname === 'api.deepgram.com' && parsed.pathname.includes('/listen')) {
          parsed.searchParams.set('interim_results', 'true');
          parsed.searchParams.set('endpointing', '300');
          parsed.searchParams.set('utterance_end_ms', '1000');
          parsed.searchParams.set('smart_format', 'false');
          parsed.searchParams.set('vad_events', 'true');
          url = parsed.toString();
        }
      } catch {}
      return Reflect.construct(target, protocols === undefined ? [url] : [url, protocols]);
    },
    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver);
    }
  });

  const nativeSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = function (handler, timeout, ...args) {
    if (timeout === 450 && typeof handler === 'function') timeout = 180;
    return nativeSetTimeout(handler, timeout, ...args);
  };

  // Deepgram can close an idle stream if the renderer stops producing audio.
  // The active recorder normally supplies audio, but a renderer/device pause
  // can leave a gap. Keep the existing app's reconnect logic intact and avoid
  // injecting fake binary audio into the stream.
  const nativeSend = NativeWebSocket.prototype.send;
  if (nativeSend && !window.__voiceChangerSendGuard) {
    window.__voiceChangerSendGuard = true;
    NativeWebSocket.prototype.send = function (data) {
      try {
        if (this.readyState === NativeWebSocket.OPEN && typeof data === 'string') {
          const parsed = JSON.parse(data);
          if (parsed?.type === 'KeepAlive') return nativeSend.call(this, data);
        }
      } catch {}
      return nativeSend.call(this, data);
    };
  }
})();
