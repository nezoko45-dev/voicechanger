// Deepgram now uses its documented Sec-WebSocket-Protocol authentication directly.
// Do not rewrite wss://api.deepgram.com connections through the local proxy.
// Browser/Electron WebSocket supports the required subprotocol list:
// ["token", DEEPGRAM_API_KEY]
const NativeWebSocket = window.WebSocket;

for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
  Object.defineProperty(NativeWebSocket, key, { value: NativeWebSocket[key] });
}

window.WebSocket = NativeWebSocket;
