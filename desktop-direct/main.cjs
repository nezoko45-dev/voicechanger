const { app, BrowserWindow, session } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'AudioServiceOutOfProcess');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream'
};

let server = null;
let mainWindow = null;

function webRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.join(__dirname, '..', 'web', 'dist');
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    const root = path.resolve(webRoot());
    const index = path.join(root, 'index.html');
    if (!fs.existsSync(index)) {
      reject(new Error(`VoiceChanger UI missing: ${index}`));
      return;
    }

    server = http.createServer((req, res) => {
      try {
        let pathname = decodeURIComponent((req.url || '/').split('?')[0]);
        if (pathname === '/') pathname = '/index.html';

        const relative = path.normalize(pathname).replace(/^([.][.][/\\])+/, '');
        const file = path.resolve(root, `.${path.sep}${relative}`);
        if (file !== root && !file.startsWith(root + path.sep)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        fs.readFile(file, (error, data) => {
          if (error) {
            res.writeHead(error.code === 'ENOENT' ? 404 : 500);
            res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
            return;
          }
          res.writeHead(200, {
            'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Resource-Policy': 'cross-origin'
          });
          res.end(data);
        });
      } catch (error) {
        console.error('[VoiceChanger Direct] HTTP error:', error);
        res.writeHead(400);
        res.end('Bad request');
      }
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}/`);
    });
  });
}

async function createWindow() {
  const url = await startLocalServer();
  const preload = path.join(__dirname, 'preload.cjs');

  if (!fs.existsSync(preload)) {
    throw new Error(`VoiceChanger preload missing: ${preload}`);
  }

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: '#090b12',
    title: 'VoiceChanger Direct',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      preload
    }
  });

  mainWindow.webContents.setAudioMuted(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[VoiceChanger Direct] renderer process gone:', details);
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
    console.error('[VoiceChanger Direct] page load failed:', code, description, validatedURL);
  });

  await mainWindow.loadURL(url);
}

function closeServer() {
  if (!server) return;
  try { server.close(); } catch (error) { console.error('[VoiceChanger Direct] server close:', error); }
  server = null;
}

process.on('uncaughtException', (error) => {
  console.error('[VoiceChanger Direct] main uncaught exception:', error?.stack || error);
});
process.on('unhandledRejection', (reason) => {
  console.error('[VoiceChanger Direct] main unhandled rejection:', reason?.stack || reason);
});

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(['media', 'microphone', 'speaker-selection', 'notifications'].includes(permission));
  });

  try {
    await createWindow();
  } catch (error) {
    console.error('[VoiceChanger Direct] startup failed:', error?.stack || error);
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => console.error('[VoiceChanger Direct] window restart failed:', error));
    }
  });
});

app.on('before-quit', closeServer);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
