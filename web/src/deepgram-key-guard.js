// Deepgram credential guard.
// Never replace or mutate the browser's WebSocket constructor: Chromium/Electron
// exposes WebSocket state constants as read-only properties.
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

// Do not monkey-patch window.WebSocket. main-fixed.js validates the key before
// constructing the native socket, which keeps Electron's native constructor
// and its read-only CONNECTING/OPEN/CLOSING/CLOSED constants untouched.
Object.defineProperty(window, "__voiceChangerNativeWebSocket", {
  value: NativeWebSocket,
  configurable: false,
  enumerable: false,
  writable: false
});

window.voiceChangerDeepgramKey = recoverKey;
window.voiceChangerRememberDeepgramKey = rememberKey;
