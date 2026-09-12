const { app, BrowserWindow, session } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Live VoiceChanger replies are generated asynchronously after STT events.
// Chromium can otherwise reject audio.play() because the call is no longer
// directly inside a user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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
    const root = webRoot();
    if (!fs.existsSync(path.join(root, 'index.html'))) {
      return reject(new Error(`Desktop UI not built: ${root}`));
    }
    server = http.createServer((req, res) => {
      let requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (requestPath === '/') requestPath = '/index.html';
      const safe = path.normalize(requestPath).replace(/^([.][.][/\\])+/, '');
      const filePath = path.join(root, safe);
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          return res.end('Not found');
        }
        res.writeHead(200, {
          'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache'
        });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
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
    title: 'VoiceChanger Desktop',
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') win.webContents.toggleDevTools();
  });
  await win.loadURL(url);
  win.webContents.on('console-message', (_event, _level, message) => console.log(`[renderer] ${message}`));
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(['media', 'microphone', 'speaker-selection', 'notifications'].includes(permission));
  });

  try {
    await createWindow();
  } catch (error) {
    console.error(error);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  try { server?.close(); } catch {}
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
