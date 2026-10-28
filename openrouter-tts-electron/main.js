const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('node:path');

const SPEECH_ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech';
const allowedModels = new Set([
  'x-ai/grok-voice-tts-1.0',
  'mistralai/voxtral-mini-tts-2603',
  'microsoft/mai-voice-2'
]);
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960, height: 850, minWidth: 650, minHeight: 620,
    title: 'OpenRouter TTS Reader',
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media');
  });
  ipcMain.handle('tts:speak', async (_event, data) => {
    const apiKey = String(data?.apiKey || '').trim();
    const model = String(data?.model || '');
    const input = String(data?.input || '').trim();
    const voice = String(data?.voice || '').trim();
    if (!apiKey.startsWith('sk-or-') || apiKey.length < 20) throw new Error('Enter a valid OpenRouter API key.');
    if (!allowedModels.has(model)) throw new Error('Choose a supported speech model.');
    if (!input) throw new Error('Enter text or dictate a phrase first.');
    if (input.length > 20000) throw new Error('Text is too long. Please split it into shorter phrases.');
    if (!voice) throw new Error('Choose a voice.');
    const response = await fetch(SPEECH_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/nezoko45-dev/voicechanger',
        'X-OpenRouter-Title': 'OpenRouter TTS Reader Desktop'
      },
      body: JSON.stringify({ model, input, voice, response_format: 'mp3' }),
      signal: AbortSignal.timeout(180000)
    });
    if (!response.ok) {
      const detail = await response.text();
      let message = detail;
      try { const parsed = JSON.parse(detail); message = parsed?.error?.message || parsed?.error || detail; } catch {}
      throw new Error('OpenRouter HTTP ' + response.status + ': ' + String(message).slice(0, 800));
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error('OpenRouter returned an empty audio response.');
    return { data: bytes.toString('base64'), mimeType: 'audio/mpeg' };
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });