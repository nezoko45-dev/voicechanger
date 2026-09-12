const { app, BrowserWindow, session, ipcMain } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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
let nativePlayer = null;
let nativeTemp = null;

function stopNativePlayer() {
  if (nativePlayer) {
    try { nativePlayer.kill(); } catch {}
    nativePlayer = null;
  }
  if (nativeTemp) {
    try { fs.unlinkSync(nativeTemp); } catch {}
    nativeTemp = null;
  }
}

function playNativeWav(base64) {
  if (process.platform !== 'win32') {
    throw new Error('Native Windows audio playback is only available on Windows.');
  }
  if (typeof base64 !== 'string' || base64.length > 20_000_000) {
    throw new Error('Invalid audio payload.');
  }

  stopNativePlayer();
  const file = path.join(os.tmpdir(), `voicechanger-${process.pid}-${Date.now()}.wav`);
  fs.writeFileSync(file, Buffer.from(base64, 'base64'));
  nativeTemp = file;

  const escaped = file.replace(/'/g, "''");
  const script = `$p = New-Object System.Media.SoundPlayer('${escaped}'); $p.PlaySync()`;
  nativePlayer = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    stdio: 'ignore'
  });
  nativePlayer.on('exit', () => {
    nativePlayer = null;
    if (nativeTemp === file) {
      try { fs.unlinkSync(file); } catch {}
      nativeTemp = null;
    }
  });
  nativePlayer.on('error', (error) => {
    console.error('[native audio]', error);
  });
  return true;
}

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
      preload: path.join(__dirname, 'preload.cjs')
    },
  });

  win.webContents.setAudioMuted(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') win.webContents.toggleDevTools();
  });
  await win.loadURL(url);
  win.webContents.on('console-message', (_event, _level, message) => console.log(`[renderer] ${message}`));
}

ipcMain.handle('native-audio:play-wav', (_event, base64) => playNativeWav(base64));
ipcMain.handle('native-audio:stop', () => { stopNativePlayer(); return true; });

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
  stopNativePlayer();
  try { server?.close(); } catch {}
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
