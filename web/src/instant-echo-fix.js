// Make live echo react to a stable interim transcript instead of waiting for
// Deepgram's relatively long final endpoint. We keep the original Deepgram
// handler intact, but synthesize a final Results event after a short quiet
// period. This reduces perceived echo latency without sending every interim
// word to Pocket TTS.
const NativeWebSocket = window.WebSocket;
const QUIET_MS = 220;
const patched = new WeakSet();
const timers = new WeakMap();
const lastText = new WeakMap();

function isDeepgramSocket(url) {
  return typeof url === "string" && url.startsWith("wss://api.deepgram.com/v1/listen");
}

function clearTimer(ws) {
  const timer = timers.get(ws);
  if (timer) clearTimeout(timer);
  timers.delete(ws);
}

function installSocket(ws) {
  if (patched.has(ws)) return ws;
  patched.add(ws);

  let handler = null;
  Object.defineProperty(ws, "onmessage", {
    configurable: true,
    enumerable: true,
    get() { return handler; },
    set(fn) {
      handler = typeof fn === "function" ? function (event) {
        let data;
        try { data = JSON.parse(event.data); } catch { return fn.call(ws, event); }
        const text = data?.type === "Results" ? data?.channel?.alternatives?.[0]?.transcript?.trim() : "";
        const isInterim = data?.type === "Results" && text && !data.is_final;

        fn.call(ws, event);

        if (!isInterim || ws.readyState !== NativeWebSocket.OPEN) return;
        const key = text.toLowerCase().replace(/\s+/g, " ").trim();
        if (!key || key === lastText.get(ws)) return;
        lastText.set(ws, key);
        clearTimer(ws);

        timers.set(ws, setTimeout(() => {
          timers.delete(ws);
          if (ws.readyState !== NativeWebSocket.OPEN || lastText.get(ws) !== key) return;
          const synthetic = {
            ...data,
            is_final: true,
            speech_final: true,
            channel: {
              ...data.channel,
              alternatives: (data.channel?.alternatives || []).map((alt, index) =>
                index === 0 ? { ...alt, transcript: text } : alt
              )
            }
          };
          try { fn.call(ws, new MessageEvent("message", { data: JSON.stringify(synthetic) })); } catch {}
        }, QUIET_MS));
      } : fn;
    }
  });

  ws.addEventListener("close", () => clearTimer(ws));
  return ws;
}

window.WebSocket = new Proxy(NativeWebSocket, {
  construct(Target, args) {
    const ws = Reflect.construct(Target, args);
    return isDeepgramSocket(args?.[0]) ? installSocket(ws) : ws;
  }
});
