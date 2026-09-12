const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');

const DEEPGRAM_HOST = 'api.deepgram.com';

function startDeepgramProxy() {
  const httpServer = http.createServer((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('VoiceChanger WebSocket proxy');
  });

  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => 'voicechanger' });

  httpServer.on('upgrade', (req, socket, head) => {
    try {
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
      if (requestUrl.pathname !== '/deepgram') {
        socket.destroy();
        return;
      }

      const protocols = String(req.headers['sec-websocket-protocol'] || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const key = protocols.length >= 2 ? protocols[1] : '';
      if (!key) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (client) => {
        wss.emit('connection', client, req, key, requestUrl.search);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (client, _req, key, query) => {
    const upstreamUrl = `wss://${DEEPGRAM_HOST}/v1/listen${query}`;
    const upstream = new WebSocket(upstreamUrl, {
      headers: { Authorization: `Token ${key}` }
    });

    const closeBoth = (code = 1000, reason = '') => {
      try { if (client.readyState === WebSocket.OPEN) client.close(code, reason); } catch {}
      try { if (upstream.readyState === WebSocket.OPEN) upstream.close(code, reason); } catch {}
    };

    upstream.on('open', () => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'VoiceChangerProxyReady' }));
    });

    upstream.on('message', (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });

    upstream.on('close', (code, reason) => {
      if (client.readyState === WebSocket.OPEN) client.close(code || 1000, reason);
    });

    upstream.on('error', (error) => {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(JSON.stringify({ type: 'VoiceChangerProxyError', message: error.message || 'Deepgram connection failed.' })); } catch {}
        client.close(1011, 'Deepgram connection failed');
      }
    });

    client.on('message', (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    });

    client.on('close', () => closeBoth());
    client.on('error', () => closeBoth(1011, 'Client connection failed'));
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      resolve({
        server: httpServer,
        url: `ws://127.0.0.1:${address.port}/deepgram`
      });
    });
  });
}

module.exports = { startDeepgramProxy };
