const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = !app.isPackaged;

function findWebIndex() {
  const candidates = isDev
    ? [
        path.join(__dirname, '..', 'web', 'dist', 'index.html'),
        path.join(__dirname, '..', 'web', 'index.html'),
      ]
    : [path.join(process.resourcesPath, 'web', 'index.html')];

  return candidates.find((p) => fs.existsSync(p));
}

function createWindow() {
  const indexPath = findWebIndex();
  if (!indexPath) {
    throw new Error('VoiceChanger web build was not found. Build web/dist before launching.');
  }

  const win = new BrowserWindow({
    width: 1220,
    height: 920,
    minWidth: 920,
    minHeight: 700,
    backgroundColor: '#070910',
    title: 'Pocket VoiceChanger',
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(indexPath);

  win.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[renderer] ${message}`);
  });
}

app.whenReady().then(() => {
  // The desktop app intentionally does not rely on COOP/COEP headers.
  // Pocket TTS is allowed to use one WASM thread in the web app.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone');
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
