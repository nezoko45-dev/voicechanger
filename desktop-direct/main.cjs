const { app, BrowserWindow, session, ipcMain } = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'AudioServiceOutOfProcess');

const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon' };
let server;
let rvcProcess = null;
const MODEL_URL = 'https://huggingface.co/0xShug0/audio.cpp-gguf/resolve/main/RVC-GGUF/rvc-f16.gguf';

function webRoot(){ return app.isPackaged ? path.join(process.resourcesPath,'web') : path.join(__dirname,'..','web','dist'); }
function rvcRoot(){ return path.join(app.getPath('userData'),'rvc-pocket'); }
function modelPath(){ return path.join(rvcRoot(),'rvc-f16.gguf'); }
function enginePath(){ return app.isPackaged ? path.join(process.resourcesPath,'rvc-engine','audiocpp_cli.exe') : path.join(__dirname,'rvc-engine','audiocpp_cli.exe'); }
function ensureRoot(){ fs.mkdirSync(rvcRoot(),{recursive:true}); }
function download(url,destination){
  return new Promise((resolve,reject)=>{
    ensureRoot(); const temp=destination+'.download';
    const request=(target)=>https.get(target,{headers:{'User-Agent':'VoiceChanger-RVC-Pocket'}},res=>{
      if([301,302,307,308].includes(res.statusCode)&&res.headers.location){res.resume();return request(res.headers.location);}
      if(res.statusCode!==200){res.resume();return reject(new Error(`RVC model download failed: HTTP ${res.statusCode}`));}
      const out=fs.createWriteStream(temp); res.pipe(out);
      out.on('finish',()=>out.close(()=>{try{fs.renameSync(temp,destination);resolve(destination);}catch(e){reject(e);}}));
      out.on('error',e=>{try{fs.unlinkSync(temp);}catch{}reject(e);});
    }).on('error',reject);
    request(url);
  });
}
async function ensureModel(){
  ensureRoot(); const file=modelPath();
  if(!fs.existsSync(file)||fs.statSync(file).size<10000000) await download(MODEL_URL,file);
  return {path:file,size:fs.statSync(file).size};
}
function runRvc(payload){
  if(process.platform!=='win32') return Promise.reject(new Error('RVC Pocket currently supports Windows desktop only.'));
  const cli=enginePath(); if(!fs.existsSync(cli)) return Promise.reject(new Error('RVC Pocket engine is missing from this EXE build.'));
  if(typeof payload?.base64Wav!=='string'||payload.base64Wav.length>40000000) return Promise.reject(new Error('Invalid or oversized WAV input.'));
  return ensureModel().then(({path:model})=>new Promise((resolve,reject)=>{
    const stamp=`${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const input=path.join(os.tmpdir(),`vc-rvc-${stamp}-in.wav`),output=path.join(os.tmpdir(),`vc-rvc-${stamp}-out.wav`);
    const cleanup=()=>{for(const f of [input,output]){try{fs.unlinkSync(f);}catch{}}};
    try{fs.writeFileSync(input,Buffer.from(payload.base64Wav,'base64'));}catch(e){return reject(e);}
    const voice=String(payload.options?.voiceId||'default').replace(/[^a-z0-9_-]/gi,'')||'default';
    const blend=Math.max(0,Math.min(1,Number(payload.options?.retrievalBlend??0)));
    const args=['--task','vc','--family','rvc','--model',model,'--backend','cpu','--audio',input,'--out',output,'--request-option',`voice_id=${voice}`];
    if(blend>0)args.push('--request-option',`retrieval_blend=${blend}`);
    const child=spawn(cli,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}); rvcProcess=child; let stderr='';
    child.stderr.on('data',d=>stderr+=d.toString());
    child.on('error',e=>{if(rvcProcess===child)rvcProcess=null;cleanup();reject(e);});
    child.on('exit',code=>{if(rvcProcess===child)rvcProcess=null;if(code!==0||!fs.existsSync(output)){cleanup();return reject(new Error(stderr.trim()||`RVC engine exited with code ${code}`));}try{const b64=fs.readFileSync(output).toString('base64');cleanup();resolve(b64);}catch(e){cleanup();reject(e);}});
  }));
}
function startLocalServer(){return new Promise((resolve,reject)=>{const root=path.resolve(webRoot());if(!fs.existsSync(path.join(root,'index.html')))return reject(new Error(`VoiceChanger UI missing: ${root}`));server=http.createServer((req,res)=>{try{let p=decodeURIComponent((req.url||'/').split('?')[0]);if(p==='/')p='/index.html';const rel=path.normalize(p).replace(/^([.][.][/\\])+/, '');const file=path.resolve(root,`.${path.sep}${rel}`);if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end('Forbidden');}fs.readFile(file,(err,data)=>{if(err){res.writeHead(err.code==='ENOENT'?404:500);return res.end(err.code==='ENOENT'?'Not found':'Server error');}res.writeHead(200,{'Content-Type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});}catch{res.writeHead(400);res.end('Bad request');}});server.on('error',reject);server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}/`));});}
async function createWindow(){const url=await startLocalServer();const win=new BrowserWindow({width:1180,height:900,minWidth:900,minHeight:680,backgroundColor:'#090b12',title:'VoiceChanger Direct',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,preload:path.join(__dirname,'preload.cjs')}});win.webContents.setAudioMuted(false);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('before-input-event',(_e,input)=>{if(input.key==='F12'&&input.type==='keyDown')win.webContents.toggleDevTools();});await win.loadURL(url);}

ipcMain.handle('rvc:status',()=>({engine:fs.existsSync(enginePath()),model:fs.existsSync(modelPath()),modelPath:modelPath()}));
ipcMain.handle('rvc:ensure-model',()=>ensureModel());
ipcMain.handle('rvc:convert-wav',(_e,payload)=>runRvc(payload));
ipcMain.handle('rvc:stop',()=>{try{rvcProcess?.kill();}catch{}rvcProcess=null;return true;});

app.whenReady().then(async()=>{session.defaultSession.setPermissionRequestHandler((_wc,p,cb)=>cb(['media','microphone','speaker-selection','notifications'].includes(p)));try{await createWindow();}catch(e){console.error('[VoiceChanger Direct] startup failed:',e);}app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow().catch(console.error);});});
app.on('before-quit',()=>{try{rvcProcess?.kill();}catch{}try{server?.close();}catch{}});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
process.on('uncaughtException',e=>console.error('[VoiceChanger Direct] uncaught:',e));
process.on('unhandledRejection',e=>console.error('[VoiceChanger Direct] rejection:',e));
