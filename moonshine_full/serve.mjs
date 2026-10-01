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
  '.tsv': 'text/tab-separated-values; charset=utf-8',
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const clean = decoded === '/' ? '/index.html' : decoded;
  const resolved = path.resolve(root, '.' + clean);
  return resolved.startsWith(root + path.sep) || resolved === root ? resolved : null;
}

function moonshineTarget(suffix) {
  // Moonshine's WASM binding asks for TTS language assets such as:
  //   /models/en_us/dict_filtered_heteronyms.tsv
  // but the authoritative CDN stores TTS assets under /tts/.
  // STT model assets use /model/ instead.
  const ttsLanguages = new Set([
    'ar_msa','de','en_gb','en_us','fr','hi','it','ja','ko','nl',
    'pt_br','pt_pt','ru','tr','uk','vi','zh_hans'
  ]);
  const clean = suffix.replace(/^\/+/, '');
  const first = clean.split('/')[0];
  if (ttsLanguages.has(first)) return `${MOONSHINE_CDN}/tts/${clean}`;
  return `${MOONSHINE_CDN}/model/${clean}`;
}

async function proxyModel(req, res) {
  const raw = decodeURIComponent((req.url || '').split('?')[0]);
  const suffix = raw.slice('/models'.length);
  if (!suffix || suffix.includes('..')) {
    res.writeHead(400);
    res.end('Bad model path');
    return;
  }

  const target = moonshineTarget(suffix);
  try {
    console.log(`[Moonshine proxy] ${suffix} -> ${target}`);
    // Do not forward Range requests. AssetDownloader needs a normal 200
    // response because it stores the response in the browser Cache API.
    const upstream = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      headers: { Accept: '*/*' },
    });

    if (!upstream.ok) {
      const message = `Moonshine CDN returned ${upstream.status} ${upstream.statusText} for ${target}`;
      console.error(message);
      res.writeHead(upstream.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(message);
      return;
    }

    // Buffer the asset before replying. Node's fetch may transparently
    // decompress an upstream response, so forwarding the CDN's original
    // Content-Length/Content-Encoding can produce a malformed cached Response.
    const bytes = Buffer.from(await upstream.arrayBuffer());

    res.statusCode = 200;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Length', String(bytes.byteLength));
    // Cache API compatibility: don't use no-store on model responses.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.removeHeader('Content-Encoding');
    res.removeHeader('Content-Range');
    res.removeHeader('Accept-Ranges');
    res.end(bytes);
  } catch (e) {
    console.error('Moonshine model proxy failed:', e);
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
  console.log('Moonshine model proxy enabled.');
  console.log('TTS language assets -> https://download.moonshine.ai/tts/');
  console.log('STT model assets -> https://download.moonshine.ai/model/');
});
