import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = root;
const port = 3000;
const pocketPort = 8000;
const voiceDir = path.join(root, 'voice-data');
const voiceWav = path.join(voiceDir, 'reference.wav');
const voiceState = path.join(voiceDir, 'reference.safetensors');
const uv = process.env.POCKET_UV || 'uv';
let pocket = null;
let pocketReady = false;

await mkdir(voiceDir, { recursive: true });

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: root, windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; process.stdout.write(d); });
    p.stderr.on('data', d => { err += d; process.stderr.write(d); });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err || out}`)));
  });
}

function startPocket() {
  if (pocket) return;
  const args = ['pocket-tts', 'serve', '--host', '127.0.0.1', '--port', String(pocketPort), '--quantize'];
  if (process.env.POCKET_VOICE === '1') args.push('--default-voice', voiceState);
  else if (process.env.POCKET_VOICE_WAV === '1') args.push('--default-voice', voiceWav);
  console.log(`Starting Pocket TTS: ${uv} ${args.join(' ')}`);
  pocket = spawn(uv, args, { cwd: root, windowsHide: false, stdio: 'inherit' });
  pocket.on('error', e => console.error('Could not start Pocket TTS:', e.message));
  pocket.on('exit', code => { console.log(`Pocket TTS exited (${code})`); pocket = null; pocketReady = false; });
}

async function waitPocket(timeoutMs=120000) {
  startPocket();
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const r = await fetch(`http://127.0.0.1:${pocketPort}/`); if (r.ok) { pocketReady = true; return true; } } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function restartPocket() {
  if (pocket) { pocket.kill(); await new Promise(r => setTimeout(r, 1500)); pocket = null; }
  pocketReady = false;
  process.env.POCKET_VOICE = '1';
  if (!await waitPocket()) throw new Error('Pocket TTS did not become ready. Check the Pocket TTS Backend window.');
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
async function body(req) { const chunks=[]; for await (const c of req) chunks.push(c); return Buffer.concat(chunks); }

async function proxyTts(req,res) {
  const raw=await body(req); let payload;
  try { payload=JSON.parse(raw.toString('utf8')); } catch { res.writeHead(400); return res.end('Invalid JSON'); }
  const text=String(payload.text||'').trim();
  if(!text){res.writeHead(400);return res.end('Text is required');}
  if(!pocketReady && !await waitPocket()){res.writeHead(503);return res.end('Pocket TTS backend is not ready.');}
  try {
    const form=new FormData(); form.append('text',text);
    const upstream=await fetch(`http://127.0.0.1:${pocketPort}/tts`,{method:'POST',body:form});
    res.statusCode=upstream.status; res.setHeader('Content-Type',upstream.headers.get('content-type')||'audio/wav');
    if(upstream.headers.get('content-disposition'))res.setHeader('Content-Disposition',upstream.headers.get('content-disposition'));
    if(!upstream.body)return res.end(Buffer.from(await upstream.arrayBuffer()));
    const reader=upstream.body.getReader(); while(true){const {done,value}=await reader.read();if(done)break;res.write(Buffer.from(value));} res.end();
  } catch(e){res.writeHead(502);res.end('Pocket TTS request failed: '+e.message);}
}

async function cloneVoice(req,res){
  const raw=await body(req); if(!raw.length){res.writeHead(400);return res.end('No voice audio received');}
  await writeFile(voiceWav,raw); console.log(`Saved voice reference (${raw.length} bytes). Exporting voice state...`);
  try { await run(uv,['pocket-tts','export-voice',voiceWav,voiceState]); await restartPocket(); res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,message:'Voice cloned and loaded.'})); }
  catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,error:e.message}));}
}

async function serveStatic(req,res){
  const urlPath=(req.url||'/').split('?')[0]; const file=urlPath==='/'?'index.html':urlPath.slice(1);
  if(file.includes('..')){res.writeHead(403);return res.end('Forbidden');}
  try {const p=path.join(publicDir,file);const data=await readFile(p);const ext=path.extname(p);const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'}[ext]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}
}

const server=http.createServer(async(req,res)=>{
  cors(res); if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  try {
    if(req.url?.startsWith('/health')){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,pocket:pocketReady,voice:process.env.POCKET_VOICE==='1'}));}
    if(req.url?.startsWith('/clone')&&req.method==='POST')return await cloneVoice(req,res);
    if(req.url?.startsWith('/tts')&&req.method==='POST')return await proxyTts(req,res);
    if(req.method==='GET')return await serveStatic(req,res);
    res.writeHead(405);res.end('Method not allowed');
  }catch(e){console.error(e);res.writeHead(500,{'Content-Type':'text/plain'});res.end(e.message);}
});
server.listen(port,'127.0.0.1',()=>{console.log(`Pocket local UI: http://127.0.0.1:${port}`);startPocket();});
process.on('SIGINT',()=>{if(pocket)pocket.kill();server.close(()=>process.exit());});
