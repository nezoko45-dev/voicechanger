// Electron-safe Deepgram transport.
// The renderer keeps the normal WebSocket-like API, while Deepgram traffic is
// handled by Electron's main process. IPC carries only strings, numbers and
// integer arrays; no callbacks/functions/Audio objects cross the bridge.
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
      this._id = nativeDeepgram.connect(
        this.url,
        Array.isArray(protocols) ? protocols.map(String) : (protocols ? [String(protocols)] : [])
      );
    }

    send(data) {
      if (this.readyState !== DeepgramSocket.OPEN) {
        throw new DOMException('WebSocket is not open', 'InvalidStateError');
      }
      nativeDeepgram.send(this._id, data);
    }

    close(code = 1000, reason = '') {
      if (this.readyState === DeepgramSocket.CLOSED || this.readyState === DeepgramSocket.CLOSING) return;
      this.readyState = DeepgramSocket.CLOSING;
      nativeDeepgram.close(this._id, code, reason);
    }
  }

  // Poll Electron for plain serializable events. This deliberately avoids
  // passing callback functions through contextBridge, which is the source of
  // the packaged-Electron "object could not be cloned" failure.
  const pollTimer = setInterval(() => {
    let events;
    try {
      events = nativeDeepgram.poll();
    } catch (error) {
      console.error('[Deepgram] native event polling failed:', error);
      return;
    }

    if (!Array.isArray(events)) return;

    for (const event of events) {
      if (!event || !Number.isInteger(event.id)) continue;
      const socket = sockets.get(event.id);
      if (!socket) continue;

      if (event.type === 'open') {
        socket.readyState = DeepgramSocket.OPEN;
        socket.protocol = event.protocol || '';
        socket.onopen?.(new Event('open'));
      } else if (event.type === 'message') {
        socket.onmessage?.({ data: event.data || '', type: 'message', target: socket });
      } else if (event.type === 'error') {
        socket.onerror?.(new Event('error'));
      } else if (event.type === 'close') {
        socket.readyState = DeepgramSocket.CLOSED;
        socket.onclose?.({
          code: event.code || 1006,
          reason: event.reason || '',
          wasClean: !!event.wasClean,
          type: 'close',
          target: socket,
        });
        sockets.delete(event.id);
      }
    }
  }, 10);

  const sockets = new Map();
  const OriginalConstructor = DeepgramSocket;
  const WrappedWebSocket = function(url, protocols) {
    if (String(url).startsWith('wss://api.deepgram.com/')) {
      const socket = new OriginalConstructor(url, protocols);
      sockets.set(socket._id, socket);
      return socket;
    }
    return new NativeWebSocket(url, protocols);
  };

  WrappedWebSocket.CONNECTING = 0;
  WrappedWebSocket.OPEN = 1;
  WrappedWebSocket.CLOSING = 2;
  WrappedWebSocket.CLOSED = 3;
  WrappedWebSocket.prototype = NativeWebSocket.prototype;
  window.WebSocket = WrappedWebSocket;

  window.addEventListener('beforeunload', () => clearInterval(pollTimer), { once: true });
}
