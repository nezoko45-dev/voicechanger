const { app, BrowserWindow, session, dialog } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Keep the Direct EXE self-contained and avoid Electron startup crashes caused by
// preload/context-bridge code. The UI does not need Node/Electron IPC.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let server = null;
let mainWindow = null;
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

// Do not let a recoverable JavaScript exception turn into Electron's generic
// "Uncaught Exception" dialog and terminate the app.
process.on('uncaughtException', (error) => {
  logError('uncaught exception', error);
});
process.on('unhandledRejection', (reason) => {
  logError('unhandled rejection', reason);
});

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
  '.onnx': 'application/octet-stream'
};

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
        logError('HTTP error', error);
        if (!res.headersSent) res.writeHead(400);
        res.end('Bad request');
      }
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        reject(new Error('Failed to start VoiceChanger local server.'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}/`);
    });
  });
}

async function createWindow() {
  const url = await startLocalServer();

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: '#090b12',
    title: 'VoiceChanger Direct',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
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
    logError('renderer process gone', details);
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
    logError('page load failed', `${code} ${description} ${validatedURL}`);
  });

  await mainWindow.loadURL(url);
}

function closeServer() {
  if (!server) return;
  try { server.close(); } catch (error) { logError('server close', error); }
  server = null;
}

app.whenReady().then(async () => {
  // Only grant permissions the browser UI actually needs.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone' || permission === 'notifications');
  });

  try {
    await createWindow();
  } catch (error) {
    logError('startup failed', error);
    try {
      await dialog.showMessageBox({
        type: 'error',
        title: 'VoiceChanger Direct could not start',
        message: 'VoiceChanger Direct failed to start safely.',
        detail: error?.message || String(error)
      });
    } catch (_) {}
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !shuttingDown) {
      createWindow().catch((error) => logError('window restart failed', error));
    }
  });
});

app.on('before-quit', () => {
  shuttingDown = true;
  closeServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
