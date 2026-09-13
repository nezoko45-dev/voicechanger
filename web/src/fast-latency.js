// Deepgram low-latency tuning.
// Keep this patch limited to Deepgram connection URLs. Do not monkey-patch
// WebSocket.prototype or global WebSocket properties in Electron.
(() => {
  const NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket || window.__voiceChangerFastLatency) return;
  window.__voiceChangerFastLatency = true;

  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args) {
      let [url, protocols] = args;
      try {
        const parsed = new URL(String(url), window.location.href);
        if (parsed.hostname === "api.deepgram.com" && parsed.pathname.includes("/listen")) {
          parsed.searchParams.set("interim_results", "true");
          parsed.searchParams.set("endpointing", "300");
          parsed.searchParams.set("utterance_end_ms", "1000");
          parsed.searchParams.set("smart_format", "false");
          parsed.searchParams.set("vad_events", "true");
          url = parsed.toString();
        }
      } catch {}
      return Reflect.construct(target, protocols === undefined ? [url] : [url, protocols]);
    },
    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver);
    }
  });
})();
