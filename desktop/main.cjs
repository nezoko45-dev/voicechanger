const { app, BrowserWindow, session, ipcMain } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const WebSocket = require('ws');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon' };
let server;
let nativePlayer = null;
let nativeTemp = null;
let nextDeepgramId = 1;
const deepgramSockets = new Map();

function stopNativePlayer() {
  if (nativePlayer) { try { nativePlayer.kill(); } catch {} nativePlayer = null; }
  if (nativeTemp) { try { fs.unlinkSync(nativeTemp); } catch {} nativeTemp = null; }
}
function playNativeWav(base64) {
  if (process.platform !== 'win32') throw new Error('Native Windows audio playback is only available on Windows.');
  if (typeof base64 !== 'string' || base64.length > 20_000_000) throw new Error('Invalid audio payload.');
  stopNativePlayer();
  const file = path.join(os.tmpdir(), `voicechanger-${process.pid}-${Date.now()}.wav`);
  fs.writeFileSync(file, Buffer.from(base64, 'base64')); nativeTemp = file;
  const escaped = file.replace(/'/g, "''");
  const script = `$p = New-Object System.Media.SoundPlayer('${escaped}'); $p.PlaySync()`;
  nativePlayer = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script], {windowsHide:true,stdio:'ignore'});
  nativePlayer.on('exit', () => { nativePlayer=null; if(nativeTemp===file){try{fs.unlinkSync(file);}catch{} nativeTemp=null;} });
  nativePlayer.on('error', e => console.error('[native audio]', e));
  return true;
}
function driverRoot(){ return app.isPackaged ? path.join(process.resourcesPath,'driver') : path.join(__dirname,'driver'); }
function driverScript(){ const file=path.join(driverRoot(),'install-voicechanger-driver.ps1'); if(!fs.existsSync(file)) throw new Error(`VoiceChanger driver installer is missing: ${file}`); return file; }
function classifyDriverOutput(output){ const text=String(output||''); return {installed:/VC_STATUS=installed/i.test(text),staged:/VC_STATUS=staged/i.test(text),reboot:/VC_STATUS=reboot/i.test(text),testsigningOff:/VC_STATUS=testsigning-off/i.test(text),missing:/VC_STATUS=missing/i.test(text)}; }
function runPowerShellScript(action,elevated=false){
  const script=driverScript(), escapedScript=script.replace(/'/g,"''");
  return new Promise((resolve,reject)=>{
    const command=elevated
      ? `$p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${escapedScript}','${action}'; exit $p.ExitCode`
      : `& powershell.exe -NoProfile -ExecutionPolicy Bypass -File '${escapedScript}' '${action}'; exit $LASTEXITCODE`;
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',command],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr=''; child.stdout.on('data',d=>stdout+=d.toString()); child.stderr.on('data',d=>stderr+=d.toString()); child.on('error',reject);
    child.on('exit',code=>{ const text=`${stdout}\n${stderr}`.trim(), status=classifyDriverOutput(text); if(code===0||status.reboot||status.installed||status.staged) resolve({ok:true,output:text,code:code??0,...status}); else resolve({ok:false,output:text||`PowerShell exited with code ${code}`,code,...status}); });
  });
}
async function getDriverStatus(){ if(process.platform!=='win32') return {supported:false,installed:false,staged:false,reboot:false,testsigningOff:false,output:'Windows is required.'}; try{const r=await runPowerShellScript('status');return {supported:true,installed:!!r.installed,staged:!!r.staged,reboot:!!r.reboot,testsigningOff:!!r.testsigningOff,output:r.output};}catch(e){return {supported:true,installed:false,staged:false,reboot:false,testsigningOff:false,output:e.message};} }
async function installDriver(){ if(process.platform!=='win32') throw new Error('The VoiceChanger virtual audio driver is Windows-only.'); const r=await runPowerShellScript('install',true); if(!r.ok&&!r.staged&&!r.reboot&&!r.installed) throw new Error(`Driver installation failed.\n\n${r.output||`PowerShell exited with code ${r.code??1}`}`); return r; }
async function uninstallDriver(){ if(process.platform!=='win32') throw new Error('The VoiceChanger virtual audio driver is Windows-only.'); const r=await runPowerShellScript('uninstall',true); if(!r.ok) throw new Error(r.output||'Driver removal failed.'); return r; }

function sendDeepgram(webContents,id,payload){ if(!webContents.isDestroyed()) webContents.send('deepgram:event',{id,...payload}); }
function connectDeepgram(event,url,protocols,clientId){
  const id=Number.isInteger(clientId)?clientId:nextDeepgramId++;
  const key=Array.isArray(protocols)&&protocols.length>=2&&protocols[0]==='token'?protocols[1]:'';
  if(!key) { sendDeepgram(event.sender,id,{type:'error',message:'Deepgram subprotocol token is missing.'}); sendDeepgram(event.sender,id,{type:'close',code:1008,reason:'Missing Deepgram token',wasClean:false}); return id; }
  try {
    const ws=new WebSocket(url,{protocols:['token',key],perMessageDeflate:false,handshakeTimeout:15000});
    const timer=setInterval(()=>{ if(ws.readyState===WebSocket.OPEN){ try{ws.send(JSON.stringify({type:'KeepAlive'}));}catch{} } },3000);
    deepgramSockets.set(id,{ws,webContents:event.sender,timer});
    ws.on('open',()=>sendDeepgram(event.sender,id,{type:'open',protocol:ws.protocol||''}));
    ws.on('message',(data,isBinary)=>{ if(isBinary) return; sendDeepgram(event.sender,id,{type:'message',data:data.toString()}); });
    ws.on('error',error=>{ console.error('[Deepgram]',error.message); sendDeepgram(event.sender,id,{type:'error',message:error.message}); });
    ws.on('close',(code,reason)=>{ clearInterval(timer); deepgramSockets.delete(id); sendDeepgram(event.sender,id,{type:'close',code:code||1006,reason:Buffer.isBuffer(reason)?reason.toString():String(reason||''),wasClean:code===1000}); });
  } catch(e){ sendDeepgram(event.sender,id,{type:'error',message:e.message}); sendDeepgram(event.sender,id,{type:'close',code:1006,reason:e.message,wasClean:false}); }
  return id;
}
function webRoot(){ return app.isPackaged ? path.join(process.resourcesPath,'web') : path.join(__dirname,'..','web','dist'); }
function startLocalServer(){ return new Promise((resolve,reject)=>{ const root=webRoot(); if(!fs.existsSync(path.join(root,'index.html'))) return reject(new Error(`Desktop UI not built: ${root}`)); server=http.createServer((req,res)=>{ let requestPath=decodeURIComponent((req.url||'/').split('?')[0]); if(requestPath==='/')requestPath='/index.html'; const safe=path.normalize(requestPath).replace(/^([.][.][/\\])+/, ''); const filePath=path.join(root,safe); if(!filePath.startsWith(root)){res.writeHead(403);return res.end('Forbidden');} fs.readFile(filePath,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':mime[path.extname(filePath).toLowerCase()]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);});}); server.on('error',reject); server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}/`)); }); }
async function createWindow(){ const url=await startLocalServer(); const win=new BrowserWindow({width:1180,height:900,minWidth:900,minHeight:680,backgroundColor:'#090b12',title:'VoiceChanger Desktop',webPreferences:{contextIsolation:true,sandbox:false,nodeIntegration:false,webSecurity:true,preload:path.join(__dirname,'preload.cjs')}}); win.webContents.setAudioMuted(false); win.webContents.setWindowOpenHandler(()=>({action:'deny'})); win.webContents.on('before-input-event',(_e,input)=>{if(input.key==='F12'&&input.type==='keyDown')win.webContents.toggleDevTools();}); await win.loadURL(url); win.webContents.on('console-message',(_e,_l,message)=>console.log(`[renderer] ${message}`)); }

ipcMain.handle('native-audio:play-wav',(_e,b64)=>playNativeWav(b64));
ipcMain.handle('native-audio:stop',()=>{stopNativePlayer();return true;});
ipcMain.handle('voicechanger-driver:status',()=>getDriverStatus());
ipcMain.handle('voicechanger-driver:install',()=>installDriver());
ipcMain.handle('voicechanger-driver:uninstall',()=>uninstallDriver());
ipcMain.on('deepgram:connect',(event,{url,protocols,clientId})=>connectDeepgram(event,url,protocols,clientId));
ipcMain.on('deepgram:send',(event,{id,data})=>{const s=deepgramSockets.get(id);if(!s||s.ws.readyState!==WebSocket.OPEN)return;try{s.ws.send(Buffer.from(data));}catch(e){sendDeepgram(event.sender,id,{type:'error',message:e.message});}});
ipcMain.on('deepgram:close',(event,{id,code,reason})=>{const s=deepgramSockets.get(id);if(!s)return;try{s.ws.close(code||1000,reason||'');}catch{} });

app.on('uncaughtException',e=>console.error('[VoiceChanger main process]',e));
process.on('unhandledRejection',r=>console.error('[VoiceChanger unhandled rejection]',r));
app.whenReady().then(async()=>{
  session.defaultSession.setPermissionRequestHandler((_wc,permission,callback)=>callback(['media','microphone','speaker-selection','notifications'].includes(permission)));
  try{await createWindow();}catch(e){console.error('[VoiceChanger] window startup failed:',e);}
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow().catch(console.error);});
});
app.on('before-quit',()=>{for(const [id,s] of deepgramSockets){try{clearInterval(s.timer);s.ws.close(1000,'Application closing');}catch{}deepgramSockets.delete(id);}stopNativePlayer();try{server?.close();}catch{}});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
