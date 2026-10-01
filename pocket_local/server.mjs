import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=3000,pocketPort=8000;
const voiceDir=path.join(root,'voice-data');
const modelConfig=path.join(root,'models','local_english.yaml');
const voiceWav=path.join(voiceDir,'reference.wav');
const voiceState=path.join(voiceDir,'reference.safetensors');
const pocketExe=process.env.POCKET_TTS_EXE||'pocket-tts.exe';
let pocket=null,pocketReady=false,voiceReady=false,pocketStarting=false;
await mkdir(voiceDir,{recursive:true});

function run(cmd,args){return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{cwd:root,windowsHide:false,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>{out+=d;process.stdout.write(d)});p.stderr.on('data',d=>{err+=d;process.stderr.write(d)});p.on('error',reject);p.on('close',c=>c===0?resolve(out):reject(new Error(`${cmd} exited ${c}: ${err||out}`)))})}

function startPocket(){
  if(pocket||pocketStarting)return;
  if(!voiceReady){console.log('[Pocket] Waiting for your custom WAV. Catalog voices are disabled.');return;}
  pocketStarting=true;
  const args=['serve','--host','127.0.0.1','--port',String(pocketPort),'--config',modelConfig,'--default-voice',voiceState];
  console.log(`[Pocket] Starting LOCAL model: ${pocketExe} ${args.join(' ')}`);
  console.log('[Pocket] No Hugging Face model download is requested after setup.');
  pocket=spawn(pocketExe,args,{cwd:root,windowsHide:false,stdio:'inherit'});
  pocketStarting=false;
  pocket.on('error',e=>{console.error('[Pocket] Could not start:',e.message);pocket=null;pocketReady=false});
  pocket.on('exit',c=>{console.log(`[Pocket] exited (${c})`);pocket=null;pocketReady=false;pocketStarting=false});
}

async function waitPocket(timeoutMs=600000){
  startPocket(); const end=Date.now()+timeoutMs; let last=0;
  while(Date.now()<end){
    try{const r=await fetch(`http://127.0.0.1:${pocketPort}/`,{signal:AbortSignal.timeout(1500)});if(r.ok){pocketReady=true;console.log('[Pocket] READY.');return true}}catch{}
    const now=Date.now(); if(now-last>10000){console.log(`[Pocket] Still loading local model... ${Math.round((now-(end-timeoutMs))/1000)}s`);last=now}
    await new Promise(r=>setTimeout(r,1000));
  }
  return false;
}
async function restartPocket(){if(pocket){try{pocket.kill()}catch{}await new Promise(r=>setTimeout(r,1500));pocket=null}pocketReady=false;if(!await waitPocket())throw new Error('Pocket TTS did not become ready within 10 minutes. Check the backend console.')}
function cors(res){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type')}
async function body(req){const chunks=[];for await(const c of req)chunks.push(c);return Buffer.concat(chunks)}

async function proxyTts(req,res){
  const raw=await body(req);let payload;try{payload=JSON.parse(raw.toString())}catch{res.writeHead(400);return res.end('Invalid JSON')}
  const text=String(payload.text||'').trim();if(!text)return(res.writeHead(400),res.end('Text is required'));
  if(!voiceReady)return(res.writeHead(409),res.end('No custom WAV voice is loaded. Catalog voices are disabled. Load your WAV first.'));
  if(!pocketReady&&!await waitPocket())return(res.writeHead(503),res.end('Pocket TTS backend is not ready.'));
  try{const form=new FormData();form.append('text',text);const upstream=await fetch(`http://127.0.0.1:${pocketPort}/tts`,{method:'POST',body:form});res.statusCode=upstream.status;res.setHeader('Content-Type',upstream.headers.get('content-type')||'audio/wav');res.end(Buffer.from(await upstream.arrayBuffer()))}
  catch(e){res.writeHead(502);res.end('Pocket TTS request failed: '+e.message)}
}

async function cloneVoice(req,res){
  const raw=await body(req);if(!raw.length)return(res.writeHead(400),res.end('No voice audio received'));
  await writeFile(voiceWav,raw);console.log(`[Voice] Saved custom WAV (${raw.length} bytes).`);console.log('[Voice] Exporting custom voice state with LOCAL model...');
  try{
    await run(pocketExe,['export-voice','--config',modelConfig,voiceWav,voiceState]);
    voiceReady=true;console.log('[Voice] Custom WAV embedding created locally.');
    await restartPocket();
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,message:'Custom WAV voice cloned and loaded from local Pocket TTS weights. Catalog voices are disabled.'}));
  }catch(e){voiceReady=false;res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:e.message}))}
}

async function serveStatic(req,res){const u=(req.url||'/').split('?')[0],file=u==='/'?'index.html':u.slice(1);if(file.includes('..'))return(res.writeHead(403),res.end('Forbidden'));try{const p=path.join(root,file),data=await readFile(p),ext=path.extname(p),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[ext]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(data)}catch{res.writeHead(404);res.end('Not found')}}

const server=http.createServer(async(req,res)=>{cors(res);if(req.method==='OPTIONS'){res.writeHead(204);return res.end()}try{
  if(req.url?.startsWith('/health')){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,pocket:pocketReady,loading:!!pocket||pocketStarting,customWav:voiceReady,localModelConfig:modelConfig}))}
  if(req.url?.startsWith('/clone')&&req.method==='POST')return cloneVoice(req,res);
  if(req.url?.startsWith('/tts')&&req.method==='POST')return proxyTts(req,res);
  if(req.method==='GET')return serveStatic(req,res);
  res.writeHead(405);res.end('Method not allowed')
}catch(e){console.error(e);res.writeHead(500);res.end(e.message)}});
server.listen(port,'127.0.0.1',()=>console.log(`[UI] http://127.0.0.1:${port}`));
process.on('SIGINT',()=>{if(pocket)pocket.kill();server.close(()=>process.exit())});
