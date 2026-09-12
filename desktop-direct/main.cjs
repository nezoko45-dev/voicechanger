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
  '.ico': 'image/x-icon'
};

let server;

function webRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.join(__dirname, '..', 'web', 'dist');
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    const root = path.resolve(webRoot());
    const index = path.join(root, 'index.html');
    if (!fs.existsSync(index)) return reject(new Error(`VoiceChanger UI missing: ${index}`));

    server = http.createServer((req, res) => {
      try {
        let requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (requestPath === '/') requestPath = '/index.html';
        const relative = path.normalize(requestPath).replace(/^([.][.][/\\])+/, '');
        const filePath = path.resolve(root, `.${path.sep}${relative}`);
        if (filePath !== root && !filePath.startsWith(root + path.sep)) {
          res.writeHead(403);
          return res.end('Forbidden');
        }
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(err.code === 'ENOENT' ? 404 : 500);
            return res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
          }
          res.writeHead(200, {
            'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store'
          });
          res.end(data);
        });
      } catch (e) {
        res.writeHead(400);
        res.end('Bad request');
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve(`http://127.0.0.1:${port}/`);
    });
  });
}

async function createWindow() {
  const url = await startLocalServer();
  const win = new BrowserWindow({
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

  win.webContents.setAudioMuted(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') win.webContents.toggleDevTools();
  });
  win.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[VoiceChanger Direct] ${message}`);
  });
  await win.loadURL(url);
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['media', 'microphone', 'speaker-selection', 'notifications'].includes(permission));
  });
  try {
    await createWindow();
  } catch (error) {
    console.error('[VoiceChanger Direct] startup failed:', error);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(console.error);
  });
});

app.on('before-quit', () => {
  try { server?.close(); } catch {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', error => console.error('[VoiceChanger Direct] uncaught:', error));
process.on('unhandledRejection', error => console.error('[VoiceChanger Direct] rejection:', error));
