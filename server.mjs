import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PORT=8765,RATE=22050,WASAPI_RATE=48000,FRAME=1920;
const MODEL_DIR=path.join(ROOT,"models");
const BASE="https://huggingface.co/TigreGotico/voiceclonnx-openvoice-v2/resolve/main/";
const FILES={ref:"tone_ref_encoder_q8.onnx",conv:"tone_converter_q8.onnx"};
let refModel=null,convModel=null,target=null,loading=null,ort=null;
let aud=null,rt=null,rtStarted=false,activeSocket=null,inputId=null,outputId=null;
let captureParts=[],captureSamples=0,converting=false,pending=null,outputQueue=Buffer.alloc(0);

function reply(res,status,data){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type"});res.end(JSON.stringify(data));}
async function getModel(kind){
  await fs.mkdir(MODEL_DIR,{recursive:true});const name=FILES[kind],file=path.join(MODEL_DIR,name);
  try{await fs.access(file);return file}catch{}
  console.log("Downloading "+name+"...");const r=await fetch(BASE+name+"?download=true");if(!r.ok)throw Error("Could not download "+name+" ("+r.status+")");
  const tmp=file+".tmp",h=await fs.open(tmp,"w");try{for await(const chunk of r.body)await h.write(chunk)}finally{await h.close()}await fs.rename(tmp,file);return file;
}
async function loadModels(){
  if(!ort)ort=await import("onnxruntime-node");if(refModel&&convModel)return;if(loading)return loading;
  loading=(async()=>{const [a,b]=await Promise.all([getModel("ref"),getModel("conv")]);console.log("Loading OpenVoice ONNX...");refModel=await ort.InferenceSession.create(a,{executionProviders:["cpu"]});convModel=await ort.InferenceSession.create(b,{executionProviders:["cpu"]});console.log("OpenVoice ONNX ready.")})().finally(()=>loading=null);return loading;
}
async function loadWasapi(){if(aud)return;if(process.platform!=="win32")throw Error("WASAPI audio is only available on Windows.");const mod=await import("audify");aud=mod.default??mod}
function wavDecode(buf){
  if(buf.toString("ascii",0,4)!=="RIFF"||buf.toString("ascii",8,12)!=="WAVE")throw Error("Reference must be a WAV file.");
  let p=12,rate=0,channels=0,bits=0,data=null;
  while(p+8<=buf.length){const id=buf.toString("ascii",p,p+4),n=buf.readUInt32LE(p+4);p+=8;if(id==="fmt "){const format=buf.readUInt16LE(p);channels=buf.readUInt16LE(p+2);rate=buf.readUInt32LE(p+4);bits=buf.readUInt16LE(p+14);if(format!==1||bits!==16)throw Error("Only PCM 16-bit WAV is supported.")}if(id==="data"){data=buf.subarray(p,p+n);break}p+=n+(n&1)}
  if(!data||!rate||!channels)throw Error("Invalid WAV data.");const out=new Float32Array(Math.floor(data.length/(2*channels)));
  for(let i=0;i<out.length;i++){let s=0;for(let c=0;c<channels;c++)s+=data.readInt16LE((i*channels+c)*2)/32768;out[i]=s/channels}return {samples:out,rate};
}
function resample(x,a,b=RATE){if(a===b)return x;const n=Math.max(1,Math.round(x.length*b/a)),out=new Float32Array(n),scale=(x.length-1)/Math.max(1,n-1);for(let i=0;i<n;i++){const q=i*scale,j=Math.floor(q),f=q-j;out[i]=(x[j]??0)*(1-f)+(x[j+1]??x[j]??0)*f}return out}
function spectrogram(x){
  const N=1024,H=256,P=384,w=new Float32Array(N);for(let i=0;i<N;i++)w[i]=0.5-0.5*Math.cos(2*Math.PI*i/(N-1));
  const pad=new Float32Array(x.length+P*2);for(let i=0;i<P;i++){pad[P-1-i]=x[Math.min(i,x.length-1)]??0;pad[P+x.length+i]=x[Math.max(0,x.length-1-i)]??0}pad.set(x,P);
  const frames=Math.max(1,Math.floor((pad.length-N)/H)+1),out=new Float32Array(frames*513);
  for(let f=0;f<frames;f++){const off=f*H,base=f*513;for(let k=0;k<=512;k++){let re=0,im=0;for(let n=0;n<N;n++){const a=2*Math.PI*k*n/N,v=pad[off+n]*w[n];re+=v*Math.cos(a);im-=v*Math.sin(a)}out[base+k]=Math.sqrt(re*re+im*im+1e-6)}}return {data:out,frames};
}
async function embed(x){const s=spectrogram(x),o=await refModel.run({spec:new ort.Tensor("float32",s.data,[1,s.frames,513])});return Float32Array.from(o.tone_embedding.data)}
async function convert(x){const s=spectrogram(x),src=await embed(x),o=await convModel.run({spec:new ort.Tensor("float32",s.data,[1,513,s.frames]),spec_lengths:new ort.Tensor("int64",BigInt64Array.from([BigInt(s.frames)]),[1]),src_g:new ort.Tensor("float32",src,[1,256,1]),tgt_g:new ort.Tensor("float32",target,[1,256,1])});return Float32Array.from(o.audio.data)}
function pcm16ToFloat(buf){const x=new Float32Array(Math.floor(buf.length/2));for(let i=0;i<x.length;i++)x[i]=buf.readInt16LE(i*2)/32768;return x}
function floatToPcm16(x){const b=Buffer.alloc(x.length*2);for(let i=0;i<x.length;i++){const v=Math.max(-1,Math.min(1,x[i]));b.writeInt16LE(v<0?v*32768:v*32767,i*2)}return b}
function appendOutput(x){const b=floatToPcm16(resample(x,RATE,WASAPI_RATE));outputQueue=Buffer.concat([outputQueue,b]);const max=WASAPI_RATE*2*0.9;if(outputQueue.length>max)outputQueue=outputQueue.subarray(outputQueue.length-max)}
function takeOutput(bytes){if(outputQueue.length>=bytes){const b=outputQueue.subarray(0,bytes);outputQueue=outputQueue.subarray(bytes);return b}const b=Buffer.alloc(bytes);outputQueue.copy(b);outputQueue=Buffer.alloc(0);return b}
function emitStatus(text){if(activeSocket?.readyState===1)activeSocket.send(JSON.stringify({type:"status",text}))}
async function convertPending(){
  if(converting||!pending)return;converting=true;const x=pending;pending=null;
  try{appendOutput(await convert(resample(x,WASAPI_RATE,RATE)))}catch(e){console.error("conversion:",e);if(activeSocket?.readyState===1)activeSocket.send(JSON.stringify({type:"error",error:e.message}))}
  finally{converting=false;if(pending)void convertPending()}
}
function pushCapture(pcm){
  if(!activeSocket)return;const x=pcm16ToFloat(pcm),need=Math.round(WASAPI_RATE*0.20);captureParts.push(x);captureSamples+=x.length;
  if(captureSamples>=need){const all=new Float32Array(captureSamples);let p=0;for(const part of captureParts){all.set(part,p);p+=part.length}captureParts=[];captureSamples=0;pending=all;void convertPending()}
}
function findDevice(list,id,kind){if(id!==null&&id!==undefined&&id!==""){const n=Number(id);if(Number.isFinite(n)&&list.some(d=>d.id===n))return n}const d=list.find(x=>kind==="input"?x.inputChannels>0:x.outputChannels>0);return d?.id}
async function devices(){await loadWasapi();const probe=new aud.RtAudio(aud.RtAudioApi.WINDOWS_WASAPI);const list=probe.getDevices();try{probe.closeStream?.()}catch{}return list}
async function stopWasapi(){if(rt){try{if(rtStarted)rt.stop()}catch{}try{rt.closeStream()}catch{}}rt=null;rtStarted=false;captureParts=[];captureSamples=0;pending=null;outputQueue=Buffer.alloc(0)}
async function startWasapi(inId,outId){
  await loadWasapi();await stopWasapi();const list=await devices();inputId=findDevice(list,inId,"input");outputId=findDevice(list,outId,"output");
  if(inputId===undefined||outputId===undefined)throw Error("Could not find a WASAPI microphone or output device.");
  rt=new aud.RtAudio(aud.RtAudioApi.WINDOWS_WASAPI);
  rt.openStream({deviceId:outputId,nChannels:1,firstChannel:0},{deviceId:inputId,nChannels:1,firstChannel:0},aud.RtAudioFormat.RTAUDIO_SINT16,WASAPI_RATE,FRAME,"VoiceChanger",pcm=>{pushCapture(pcm);rt.write(takeOutput(FRAME*2))});
  rt.start();rtStarted=true;console.log("WASAPI started. input="+inputId+" output="+outputId);emitStatus("WASAPI listening");
}
const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8"};
const server=http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS"){res.writeHead(204,{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type"});return res.end()}
  const pathname=decodeURIComponent(new URL(req.url||"/","http://127.0.0.1:"+PORT).pathname);
  if(pathname==="/health"&&req.method==="GET")return reply(res,200,{ok:true,models:!!(refModel&&convModel),voice:!!target,wasapi:process.platform==="win32",running:rtStarted,inputId,outputId});
  if(pathname==="/devices"&&req.method==="GET"){try{return reply(res,200,{ok:true,devices:await devices()})}catch(e){return reply(res,500,{ok:false,error:e.message})}}
  if(pathname==="/target"&&req.method==="POST"){try{const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));if(typeof body.wav!=="string"||!body.wav)throw Error("No WAV data was provided.");const wav=wavDecode(Buffer.from(body.wav,"base64"));await loadModels();target=await embed(resample(wav.samples,wav.rate));return reply(res,200,{ok:true})}catch(e){console.error(e);return reply(res,500,{ok:false,error:e.message})}}
  if(req.method==="GET"){const relative=pathname==="/"?"/index.html":pathname,file=path.resolve(ROOT,"."+relative),rootWithSep=ROOT.endsWith(path.sep)?ROOT:ROOT+path.sep;if((file===ROOT||file.startsWith(rootWithSep))&&file!==path.join(ROOT,"server.mjs")){try{const data=await fs.readFile(file);res.writeHead(200,{"Content-Type":MIME[path.extname(file).toLowerCase()]||"application/octet-stream","Cache-Control":"no-store"});return res.end(data)}catch{}}}
  reply(res,404,{ok:false,error:"Not found"});
});
server.listen(PORT,"127.0.0.1",async()=>{console.log("VoiceChanger ready: http://127.0.0.1:"+PORT);try{await loadWasapi();console.log("WASAPI audio backend ready.")}catch(e){console.error("WASAPI backend unavailable:",e.message)}});
(async()=>{try{const {WebSocketServer}=await import("ws");const wss=new WebSocketServer({server,path:"/audio"});wss.on("connection",ws=>{activeSocket=ws;ws.on("message",async raw=>{try{const m=JSON.parse(raw);if(m.type==="devices"){ws.send(JSON.stringify({type:"devices",devices:await devices()}));return}if(m.type==="start"){if(!target)throw Error("Load a reference WAV first.");await startWasapi(m.inputId,m.outputId);return}if(m.type==="stop"){await stopWasapi();emitStatus("WASAPI stopped");return}}catch(e){console.error("audio:",e);if(ws.readyState===1)ws.send(JSON.stringify({type:"error",error:e.message}))}});ws.on("close",async()=>{if(activeSocket===ws){activeSocket=null;await stopWasapi()}})})}catch(e){console.error("WebSocket backend unavailable:",e.message)}})();
