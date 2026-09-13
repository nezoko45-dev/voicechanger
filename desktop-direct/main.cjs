const { app, shell, dialog } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// VoiceChanger Direct is now a lightweight EXE launcher/backend.
// It serves the real web UI over localhost and opens that UI in the user's
// normal Chrome/Edge browser. Electron no longer hosts the app window.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let server = null;
let browserUrl = null;
let shuttingDown = false;

function logError(prefix, error) {
  const message = error?.stack || error?.message || String(error);
  console.error(`[VoiceChanger Direct] ${prefix}:`, message);
  try {
    const logFile = path.join(app.getPath('userData'), 'voicechanger-direct-error.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${prefix}: ${message}\n`);
  } catch (_) {}
}

process.on('uncaughtException', (error) => logError('uncaught exception', error));
process.on('unhandledRejection', (reason) => logError('unhandled rejection', reason));

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.map': 'application/json; charset=utf-8'
};

function webRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.join(__dirname, '..', 'web', 'dist');
}

function safeFilePath(root, pathname) {
  const cleanPath = pathname === '/' ? '/index.html' : pathname;
  const relative = path.normalize(cleanPath).replace(/^([.][.][/\\])+/, '');
  const file = path.resolve(root, `.${path.sep}${relative}`);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return file;
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    const root = path.resolve(webRoot());
    const index = path.join(root, 'index.html');

    if (!fs.existsSync(index)) {
      reject(new Error(`VoiceChanger web UI missing: ${index}`));
      return;
    }

    server = http.createServer((req, res) => {
      try {
        let pathname = decodeURIComponent((req.url || '/').split('?')[0]);
        const file = safeFilePath(root, pathname);

        if (!file) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        fs.readFile(file, (error, data) => {
          if (error) {
            res.writeHead(error.code === 'ENOENT' ? 404 : 500, {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store'
            });
            res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
            return;
          }

          res.writeHead(200, {
            'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
            // Required for Pocket TTS/ONNX browser workers and SharedArrayBuffer
            // where supported by the browser.
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Resource-Policy': 'cross-origin',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*'
          });
          res.end(data);
        });
      } catch (error) {
        logError('HTTP error', error);
        if (!res.headersSent) res.writeHead(400);
        res.end('Bad request');
      }
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        reject(new Error('Failed to start VoiceChanger local web server.'));
        return;
      }
      browserUrl = `http://127.0.0.1:${address.port}/`;
      resolve(browserUrl);
    });
  });
}

async function openBrowser(url) {
  // shell.openExternal uses the user's normal OS browser (Chrome, Edge, etc.)
  // rather than creating another Electron BrowserWindow.
  const opened = await shell.openExternal(url);
  if (opened === false) {
    throw new Error(`Could not open the VoiceChanger web UI in the default browser: ${url}`);
  }
}

function closeServer() {
  if (!server) return;
  try { server.close(); } catch (error) { logError('server close', error); }
  server = null;
}

app.whenReady().then(async () => {
  try {
    const url = await startLocalServer();
    await openBrowser(url);
    console.log(`[VoiceChanger Direct] Web UI running at ${url}`);
  } catch (error) {
    logError('startup failed', error);
    try {
      await dialog.showMessageBox({
        type: 'error',
        title: 'VoiceChanger Direct could not start',
        message: 'VoiceChanger Direct could not start the browser web UI.',
        detail: error?.message || String(error)
      });
    } catch (_) {}
    app.quit();
    return;
  }

  // Keep the EXE process alive while the browser uses the localhost backend.
  // A second launch re-opens the same running service instead of starting
  // another copy on a new port.
  app.on('second-instance', async () => {
    if (browserUrl) {
      try { await openBrowser(browserUrl); } catch (error) { logError('browser reopen failed', error); }
    }
  });
});

app.on('before-quit', () => {
  shuttingDown = true;
  closeServer();
});

app.on('window-all-closed', () => {
  // There is intentionally no Electron window in browser-backed mode.
  if (process.platform !== 'darwin' && !shuttingDown) {
    // Keep the backend alive until the user closes the EXE.
  }
});
