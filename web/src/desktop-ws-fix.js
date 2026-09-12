// Fresh desktop Deepgram transport.
// Renderer code keeps the normal WebSocket API, but Deepgram traffic is handled
// by Electron's main process using the ws package. This removes browser/Electron
// WebSocket handshake instability while retaining Deepgram's Sec-WebSocket-Protocol
// authentication: ["token", API_KEY].
const NativeWebSocket = window.WebSocket;
const nativeDeepgram = window.nativeDeepgram;

if (!nativeDeepgram) {
  console.warn('[Deepgram] native transport unavailable; using browser WebSocket.');
} else {
  class DeepgramSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url, protocols) {
      this.url = String(url);
      this.protocol = '';
      this.readyState = DeepgramSocket.CONNECTING;
      this.bufferedAmount = 0;
      this.binaryType = 'arraybuffer';
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;
      this._id = nativeDeepgram.connect(this.url, Array.isArray(protocols) ? protocols : (protocols ? [protocols] : []));
      this._listener = (event) => {
        if (!event || event.id !== this._id) return;
        if (event.type === 'open') {
          this.readyState = DeepgramSocket.OPEN;
          this.protocol = event.protocol || '';
          this.onopen?.(new Event('open'));
        } else if (event.type === 'message') {
          this.onmessage?.({ data: event.data, type: 'message', target: this });
        } else if (event.type === 'error') {
          this.onerror?.(new Event('error'));
        } else if (event.type === 'close') {
          this.readyState = DeepgramSocket.CLOSED;
          this.onclose?.({ code: event.code || 1006, reason: event.reason || '', wasClean: !!event.wasClean, type: 'close', target: this });
          nativeDeepgram.removeListener?.(this._listener);
        }
      };
      nativeDeepgram.addListener(this._listener);
    }

    send(data) {
      if (this.readyState !== DeepgramSocket.OPEN) throw new DOMException('WebSocket is not open', 'InvalidStateError');
      nativeDeepgram.send(this._id, data);
    }

    close(code = 1000, reason = '') {
      if (this.readyState === DeepgramSocket.CLOSED || this.readyState === DeepgramSocket.CLOSING) return;
      this.readyState = DeepgramSocket.CLOSING;
      nativeDeepgram.close(this._id, code, reason);
    }
  }

  const WrappedWebSocket = function(url, protocols) {
    if (String(url).startsWith('wss://api.deepgram.com/')) return new DeepgramSocket(url, protocols);
    return new NativeWebSocket(url, protocols);
  };
  WrappedWebSocket.CONNECTING = 0;
  WrappedWebSocket.OPEN = 1;
  WrappedWebSocket.CLOSING = 2;
  WrappedWebSocket.CLOSED = 3;
  WrappedWebSocket.prototype = NativeWebSocket.prototype;
  window.WebSocket = WrappedWebSocket;
}
