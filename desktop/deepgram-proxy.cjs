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
    let upstream = null;
    let closedByClient = false;
    let reconnectTimer = null;
    let reconnectAttempt = 0;
    let keepAliveTimer = null;

    const clearTimers = () => {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
    };

    const closeBoth = (code = 1000, reason = '') => {
      closedByClient = true;
      clearTimers();
      try { if (client.readyState === WebSocket.OPEN) client.close(code, reason); } catch {}
      try { if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) upstream.close(code, reason); } catch {}
    };

    const scheduleUpstreamReconnect = () => {
      if (closedByClient || client.readyState !== WebSocket.OPEN || reconnectTimer) return;
      const delay = Math.min(5000, 500 * Math.pow(2, Math.min(reconnectAttempt, 3)));
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectUpstream();
      }, delay);
    };

    const connectUpstream = () => {
      if (closedByClient || client.readyState !== WebSocket.OPEN) return;
      try {
        upstream = new WebSocket(`wss://${DEEPGRAM_HOST}/v1/listen${query}`, {
          headers: { Authorization: `Token ${key}` }
        });
      } catch (error) {
        if (client.readyState === WebSocket.OPEN) {
          try { client.send(JSON.stringify({ type: 'VoiceChangerProxyError', message: error.message || 'Deepgram connection failed.' })); } catch {}
        }
        scheduleUpstreamReconnect();
        return;
      }

      upstream.binaryType = 'arraybuffer';
      upstream.on('open', () => {
        reconnectAttempt = 0;
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        keepAliveTimer = setInterval(() => {
          if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
          try { upstream.send(JSON.stringify({ type: 'KeepAlive' })); } catch {}
        }, 5000);
        if (client.readyState === WebSocket.OPEN) {
          try { client.send(JSON.stringify({ type: 'VoiceChangerProxyReady' })); } catch {}
        }
      });

      upstream.on('message', (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
      });

      upstream.on('close', (code, reason) => {
        if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
        if (!closedByClient && client.readyState === WebSocket.OPEN) {
          try { client.send(JSON.stringify({ type: 'VoiceChangerProxyReconnecting', code: code || 1000 })); } catch {}
          scheduleUpstreamReconnect();
        }
      });

      upstream.on('error', (error) => {
        if (client.readyState === WebSocket.OPEN) {
          try { client.send(JSON.stringify({ type: 'VoiceChangerProxyError', message: error.message || 'Deepgram connection failed.' })); } catch {}
        }
      });
    };

    client.on('message', (data, isBinary) => {
      if (upstream?.readyState === WebSocket.OPEN) {
        try { upstream.send(data, { binary: isBinary }); } catch {}
      }
    });

    client.on('close', () => closeBoth());
    client.on('error', () => closeBoth(1011, 'Client connection failed'));
    connectUpstream();
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
