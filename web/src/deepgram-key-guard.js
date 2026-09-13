// Prevent UI/error strings from ever becoming Deepgram WebSocket subprotocols.
// This is deliberately installed before main-fixed.js creates any WebSocket.
const NativeWebSocket = window.WebSocket;
const SAFE_KEY = "voicechanger.deepgramKey.safe";

function validKey(value) {
  const key = String(value || "").trim();
  return !!key && !/[\s\u0000-\u001f\u007f]/.test(key);
}

function rememberKey(value) {
  if (validKey(value)) {
    try { localStorage.setItem(SAFE_KEY, String(value).trim()); } catch {}
  }
}

function recoverKey() {
  const input = document.getElementById("deepgramKey");
  const candidates = [
    input?.value,
    localStorage.getItem(SAFE_KEY),
    localStorage.getItem("voicechanger.deepgramKey")
  ];
  for (const candidate of candidates) if (validKey(candidate)) return String(candidate).trim();
  return "";
}

const keyInput = document.getElementById("deepgramKey");
if (keyInput) {
  rememberKey(keyInput.value);
  keyInput.addEventListener("input", () => rememberKey(keyInput.value));
}

window.WebSocket = new Proxy(NativeWebSocket, {
  construct(Target, args) {
    if (Array.isArray(args[1])) {
      const protocols = [...args[1]];
      // Only the Deepgram token protocol may contain the API key.
      if (protocols.length >= 2 && protocols[0] === "token" && !validKey(protocols[1])) {
        const recovered = recoverKey();
        if (!recovered) throw new DOMException("Enter a valid Deepgram API key.", "SyntaxError");
        protocols[1] = recovered;
        args[1] = protocols;
      }
    }
    return Reflect.construct(Target, args);
  }
});

window.WebSocket.CONNECTING = NativeWebSocket.CONNECTING;
window.WebSocket.OPEN = NativeWebSocket.OPEN;
window.WebSocket.CLOSING = NativeWebSocket.CLOSING;
window.WebSocket.CLOSED = NativeWebSocket.CLOSED;
