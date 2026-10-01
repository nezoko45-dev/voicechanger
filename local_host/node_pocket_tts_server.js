const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const PORT = 8765;
const HOST = '127.0.0.1';

// Node-only local bridge. It intentionally does NOT start Python.
// The browser UI can use this bridge for status/control messages while
// the model/runtime is supplied separately by the local Node installation.
const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify({
    ok: true,
    service: 'pocket-tts-local-node',
    websocket: `ws://${HOST}:${PORT}`,
    runtime: 'node'
  }));
});

const wss = new WebSocket.Server({ server });

let clientCount = 0;
let reference = null;

wss.on('connection', ws => {
  clientCount++;
  console.log(`[WS] GitHub Pages connected (${clientCount})`);

  ws.send(JSON.stringify({
    type: 'ready',
    runtime: 'node',
    inference: 'local',
    message: 'Node local voice bridge connected'
  }));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' })); }

    if (msg.type === 'ping') {
      return ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
    }

    if (msg.type === 'load-reference') {
      reference = {
        name: String(msg.name || 'reference.wav'),
        data: msg.data || null
      };
      console.log(`[VOICE] Reference received: ${reference.name}`);
      return ws.send(JSON.stringify({ type: 'reference-ready', name: reference.name }));
    }

    if (msg.type === 'speak') {
      if (!reference) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Load a WAV reference first.' }));
      }
      // This message is deliberately explicit rather than pretending that
      // Node can execute the browser's onnxruntime-web model unchanged.
      return ws.send(JSON.stringify({
        type: 'engine-status',
        state: 'waiting-for-node-runtime',
        message: 'Local Node bridge received the TTS request.'
      }));
    }
  });

  ws.on('close', () => {
    clientCount = Math.max(0, clientCount - 1);
    console.log(`[WS] Client disconnected (${clientCount})`);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Pocket TTS Node bridge: http://${HOST}:${PORT}`);
  console.log(`WebSocket: ws://${HOST}:${PORT}`);
  console.log('No Python runtime is used by this server.');
});
