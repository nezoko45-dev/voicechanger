import http from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8788);
const host = '127.0.0.1';
const MOONSHINE_CDN = 'https://download.moonshine.ai';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const clean = decoded === '/' ? '/index.html' : decoded;
  const resolved = path.resolve(root, '.' + clean);
  return resolved.startsWith(root + path.sep) || resolved === root ? resolved : null;
}

async function proxyModel(req, res) {
  const raw = decodeURIComponent((req.url || '').split('?')[0]);
  const suffix = raw.slice('/models'.length);
  if (!suffix || suffix.includes('..')) {
    res.writeHead(400);
    res.end('Bad model path');
    return;
  }
  const target = MOONSHINE_CDN + suffix;
  try {
    // Fetch the complete asset instead of forwarding Range requests. This gives
    // Cache.put() a normal 200 response instead of a partial 206 response.
    const upstream = await fetch(target, { redirect: 'follow' });
    if (!upstream.ok) {
      res.writeHead(upstream.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Moonshine CDN returned ${upstream.status}`);
      return;
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const length = upstream.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.writeHead(200);
    if (upstream.body) {
      for await (const chunk of upstream.body) res.write(chunk);
    }
    res.end();
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Moonshine model proxy failed: ' + e.message);
  }
}

const server = http.createServer(async (req, res) => {
  // Required by Moonshine WASM's threaded/SIMD browser build.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Permissions-Policy', 'microphone=(self), speaker-selection=(self)');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if ((req.url || '').startsWith('/models/')) {
    await proxyModel(req, res);
    return;
  }

  const requested = (req.url || '/').split('?')[0];
  if (requested === '/' || requested === '/index.html') {
    req.url = '/index_fixed.html';
  }

  const file = safePath(req.url || '/');
  if (!file) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const ext = path.extname(file).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', info.size);
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(port, host, () => {
  console.log(`Moonshine full app: http://${host}:${port}/`);
  console.log('Local Moonshine model proxy: /models/* -> https://download.moonshine.ai/*');
});
