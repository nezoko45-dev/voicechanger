import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const PORT = 8789;
const VOICES = path.join(ROOT, 'voices');
const OUT = path.join(ROOT, 'output');
fs.mkdirSync(VOICES, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

let busy = false;
let ready = false;
let lastError = '';
let voicePath = '';

const pocket = process.platform === 'win32'
  ? path.join(process.env.USERPROFILE || '', '.local', 'bin', 'pocket-tts.exe')
  : 'pocket-tts';

function send(res, code, data, type='application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin':'*', 'Cache-Control':'no-store' });
  res.end(type.includes('json') ? JSON.stringify(data) : data);
}
function run(args, timeout=600000) {
  return new Promise((resolve, reject) => {
    const p = spawn(pocket, args, { windowsHide:true });
    let stdout='', stderr='';
    const timer=setTimeout(()=>{ p.kill(); reject(new Error('Pocket TTS timed out')); }, timeout);
    p.stdout.on('data',d=>stdout+=d); p.stderr.on('data',d=>stderr+=d);
    p.on('error',e=>{clearTimeout(timer);reject(e)});
    p.on('close',code=>{clearTimeout(timer); if(code===0) resolve({stdout,stderr}); else reject(new Error(`${stderr || stdout}\nPocket TTS exited ${code}`));});
  });
}
async function cloneVoice(file) {
  const target=path.join(VOICES,'my_voice.safetensors');
  await run(['export-voice', file, target, '--language','english'], 900000);
  voicePath=target; ready=true; return target;
}
async function generate(text) {
  const target=path.join(OUT,`tts_${Date.now()}.wav`);
  await run(['generate','--language','english','--voice',voicePath,'--text',text,'--output-path',target],900000);
  return target;
}

const server=http.createServer(async(req,res)=>{
  try {
    const u=new URL(req.url,`http://127.0.0.1:${PORT}`);
    if(req.method==='OPTIONS') { res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'}); return res.end(); }
    if(u.pathname==='/health') return send(res,200,{ok:true,busy,ready,voice:!!voicePath,error:lastError});
    if(u.pathname==='/clone' && req.method==='POST') {
      if(busy) return send(res,409,{ok:false,error:'Backend is busy'});
      const chunks=[]; for await(const c of req) chunks.push(c); const body=Buffer.concat(chunks);
      const file=path.join(VOICES,'reference.wav'); fs.writeFileSync(file,body);
      busy=true; lastError='';
      try { await cloneVoice(file); send(res,200,{ok:true,voice:'my_voice.safetensors'}); }
      catch(e){ ready=false; lastError=e.message; send(res,500,{ok:false,error:e.message}); }
      finally { busy=false; }
      return;
    }
    if(u.pathname==='/tts' && req.method==='POST') {
      if(!ready || !voicePath) return send(res,409,{ok:false,error:'Load your custom WAV first'});
      if(busy) return send(res,409,{ok:false,error:'Backend is busy'});
      const chunks=[]; for await(const c of req) chunks.push(c); const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
      if(!body.text?.trim()) return send(res,400,{ok:false,error:'Missing text'});
      busy=true; lastError='';
      try { const wav=await generate(body.text.trim()); const audio=fs.readFileSync(wav); send(res,200,audio,'audio/wav'); fs.unlink(wav,()=>{}); }
      catch(e){ lastError=e.message; send(res,500,{ok:false,error:e.message}); }
      finally { busy=false; }
      return;
    }
    if(u.pathname==='/' || u.pathname==='/index.html') {
      const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8'); return send(res,200,html,'text/html; charset=utf-8');
    }
    res.writeHead(404); res.end('Not found');
  } catch(e) { send(res,500,{ok:false,error:e.message}); }
});
server.listen(PORT,'127.0.0.1',()=>console.log(`TRUE Pocket TTS voice-clone server: http://127.0.0.1:${PORT}`));
