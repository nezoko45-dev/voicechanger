// Low-latency Deepgram transport tuning.
// Loaded before main-fixed.js so its existing reconnecting STT client gets the fast settings.
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
          parsed.searchParams.set('endpointing', '150');
          parsed.searchParams.set('utterance_end_ms', '700');
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

  // main-fixed uses a 450ms short-pause debounce before handing text to Pocket TTS.
  // Reduce that one known delay to 120ms without changing unrelated timers.
  const nativeSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = function (handler, timeout, ...args) {
    if (timeout === 450 && typeof handler === 'function') timeout = 120;
    return nativeSetTimeout(handler, timeout, ...args);
  };
})();
