// Low-latency Deepgram transport tuning.
// This runs before main-fixed.js and rewrites only Deepgram listen URLs.
// Pocket TTS already streams its first audio chunk from a worker; the main
// latency problem was waiting too long to decide that the speaker stopped.
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
          parsed.searchParams.set('endpointing', '250');
          parsed.searchParams.set('utterance_end_ms', '1000');
          parsed.searchParams.set('smart_format', 'false');
          parsed.searchParams.set('vad_events', 'true');
          url = parsed.toString();
        }
      } catch {}
      return Reflect.construct(target, [url, protocols], new.target);
    },
    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver);
    }
  });

  // main-fixed currently waits 450ms after an interim pause before sending a
  // short phrase to Pocket TTS. Reduce only that known debounce without
  // globally changing application timers.
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  window.setTimeout = function (handler, timeout, ...args) {
    if (timeout === 450 && typeof handler === 'function') timeout = 180;
    return nativeSetTimeout(handler, timeout, ...args);
  };
  window.clearTimeout = function (id) { return nativeClearTimeout(id); };
})();
