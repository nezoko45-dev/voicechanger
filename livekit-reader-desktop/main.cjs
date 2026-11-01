const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
let win;
const settingsPath = () => path.join(app.getPath('userData'), 'credentials.bin');
function readCredentials() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const encrypted = fs.readFileSync(settingsPath());
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch { return null; }
}
function saveCredentials(data) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure credential storage is unavailable.');
  const safe = { apiKey: String(data.apiKey || '').trim(), apiSecret: String(data.apiSecret || '').trim() };
  if (!safe.apiKey || !safe.apiSecret) throw new Error('Enter both your LiveKit API key and secret.');
  fs.writeFileSync(settingsPath(), safeStorage.encryptString(JSON.stringify(safe)));
}
function wavBuffer(frame) {
  const pcm = Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
  const channels = frame.channels || 1, sampleRate = frame.sampleRate || 24000;
  const h = Buffer.alloc(44);
  h.write('RIFF',0); h.writeUInt32LE(36+pcm.length,4); h.write('WAVE',8); h.write('fmt ',12);
  h.writeUInt32LE(16,16); h.writeUInt16LE(1,20); h.writeUInt16LE(channels,22);
  h.writeUInt32LE(sampleRate,24); h.writeUInt32LE(sampleRate*channels*2,28);
  h.writeUInt16LE(channels*2,32); h.writeUInt16LE(16,34); h.write('data',36); h.writeUInt32LE(pcm.length,40);
  return wav;
}
function createWindow() {
  win = new BrowserWindow({width:1080,height:760,minWidth:760,minHeight:600,backgroundColor:'#10131c',
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false}});
  win.loadFile(path.join(__dirname,'index.html'));
}
app.whenReady().then(createWindow);
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
ipcMain.handle('credentials:save',(_e,data)=>{saveCredentials(data);return {ok:true}});
ipcMain.handle('credentials:status',()=>({saved:!!readCredentials(),secure:safeStorage.isEncryptionAvailable()}));
ipcMain.handle('credentials:clear',()=>{try{fs.unlinkSync(settingsPath())}catch{};return {ok:true}});
ipcMain.handle('tts:synthesize',async(_e,{text,voice,speed})=>{
  const credentials=readCredentials();
  if(!credentials) throw new Error('Save your LiveKit API key and secret first.');
  if(typeof text!=='string'||!text.trim()) throw new Error('Enter text to read.');
  if(text.length>5000) throw new Error('Please keep each request under 5,000 characters.');
  const {inference}=await import('@livekit/agents');
  const tts=new inference.TTS({apiKey:credentials.apiKey,apiSecret:credentials.apiSecret,
    model:'fishaudio/s2.1-pro',voice:voice||'b347db033a6549378b48d00acb0d06cd',language:'en',
    modelOptions:{speed:Math.max(.5,Math.min(2,Number(speed)||1)),latency:'balanced'}});
  try {
    const frame=await tts.synthesize(text.trim()).collect();
    const wav=wavBuffer(frame);
    return wav.toString('base64');
  } finally { await tts.close?.(); }
});
