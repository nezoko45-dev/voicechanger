import http from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8788);
const host = '127.0.0.1';
const MOONSHINE_CDN = 'https://download.moonshine.ai';
const MOONSHINE_HF = 'https://huggingface.co/moonshine-ai/moonshine-voice-assets/resolve/main';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const clean = decoded === '/' ? '/index.html' : decoded;
  const resolved = path.resolve(root, '.' + clean);
  return resolved.startsWith(root + path.sep) || resolved === root ? resolved : null;
}

function moonshineTargets(suffix) {
  const ttsLanguages = new Set([
    'ar_msa','de','en_gb','en_us','fr','hi','it','ja','ko','nl',
    'pt_br','pt_pt','ru','tr','uk','vi','zh_hans'
  ]);
  const clean = suffix.replace(/^\/+/, '');
  const first = clean.split('/')[0];

  if (ttsLanguages.has(first)) {
    // The official runtime TTS assets live under /tts/. The official
    // Hugging Face mirror preserves the same CDN hierarchy.
    return [
      `${MOONSHINE_CDN}/tts/${clean}`,
      `${MOONSHINE_HF}/tts/${clean}`,
    ];
  }

  return [
    `${MOONSHINE_CDN}/model/${clean}`,
    `${MOONSHINE_HF}/model/${clean}`,
  ];
}

async function fetchAsset(target) {
  return fetch(target, {
    method: 'GET',
    redirect: 'follow',
    headers: { Accept: '*/*', 'User-Agent': 'MoonshineLocalBridge/1.0' },
  });
}

async function proxyModel(req, res) {
  const raw = decodeURIComponent((req.url || '').split('?')[0]);
  const suffix = raw.slice('/models'.length);
  if (!suffix || suffix.includes('..')) {
    res.writeHead(400);
    res.end('Bad model path');
    return;
  }

  const targets = moonshineTargets(suffix);
  let upstream = null;
  let targetUsed = '';
  let lastStatus = 502;

  try {
    for (const target of targets) {
      try {
        console.log(`[Moonshine proxy] trying ${suffix} -> ${target}`);
        const candidate = await fetchAsset(target);
        if (candidate.ok) {
          upstream = candidate;
          targetUsed = target;
          break;
        }
        lastStatus = candidate.status;
        console.warn(`[Moonshine proxy] ${candidate.status} ${candidate.statusText}: ${target}`);
      } catch (e) {
        console.warn(`[Moonshine proxy] fetch failed: ${target}: ${e.message}`);
      }
    }

    if (!upstream) {
      const message = `Moonshine asset unavailable (${lastStatus}): ${suffix}`;
      console.error(message);
      res.writeHead(lastStatus, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(message);
      return;
    }

    // Buffer before replying. Cache.put() is strict about malformed/partial
    // responses, and Node fetch may transparently decompress CDN responses.
    const bytes = Buffer.from(await upstream.arrayBuffer());

    res.statusCode = 200;
    res.setHeader('Content-Type', upstream.headers.get('content-type') || MIME[path.extname(suffix).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Content-Length', String(bytes.byteLength));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Moonshine-Asset-Source', targetUsed.startsWith(MOONSHINE_CDN) ? 'cdn' : 'huggingface-mirror');
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
  console.log('Model proxy: CDN first, official Hugging Face mirror fallback.');
  console.log('TTS assets: /models/<lang>/... -> /tts/<lang>/...');
});
