import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PORT=8765,RATE=22050,WASAPI_RATE=48000,FRAME=1920,CHUNK_SECONDS=0.40;
const MODEL_DIR=path.join(ROOT,"models");
const BASE="https://huggingface.co/TigreGotico/voiceclonnx-openvoice-v2/resolve/main/";
const FILES={ref:"tone_ref_encoder_q8.onnx",conv:"tone_converter_q8.onnx"};
let refModel=null,convModel=null,target=null,loading=null,ort=null;
let aud=null,rt=null,rtStarted=false,activeSocket=null,sourceSocket=null,inputId=null,outputId=null;
let deepgramWs=null,deepgramKey="",speechActive=false,speechBuffer=[],speechSamples=0,preBuffer=[],preSamples=0,speechTimer=null,speechGeneration=0;
let converting=false,pendingQueue=[],outputQueue=Buffer.alloc(0);
let outputStarted=false,underruns=0;

function reply(res,status,data){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type"});res.end(JSON.stringify(data));}
async function getModel(kind){
  await fs.mkdir(MODEL_DIR,{recursive:true});const name=FILES[kind],file=path.join(MODEL_DIR,name);
  try{await fs.access(file);return file}catch{}
  console.log("Downloading "+name+"...");const r=await fetch(BASE+name+"?download=true");if(!r.ok)throw Error("Could not download "+name+" ("+r.status+")");
  const tmp=file+".tmp",h=await fs.open(tmp,"w");try{for await(const chunk of r.body)await h.write(chunk)}finally{await h.close()}await fs.rename(tmp,file);return file;
}
async function loadModels(){
  if(!ort)ort=await import("onnxruntime-node");if(refModel&&convModel)return;if(loading)return loading;
  loading=(async()=>{const [a,b]=await Promise.all([getModel("ref"),getModel("conv")]);console.log("Loading OpenVoice ONNX...");
    const options={executionProviders:["cpu"],intraOpNumThreads:Math.max(1,Math.min(8,(Number(process.env.NUMBER_OF_PROCESSORS)||4)-1)),interOpNumThreads:1};
    refModel=await ort.InferenceSession.create(a,options);convModel=await ort.InferenceSession.create(b,options);console.log("OpenVoice ONNX ready.")})().finally(()=>loading=null);return loading;
}
async function loadWasapi(){if(aud)return;if(process.platform!=="win32")throw Error("WASAPI audio is only available on Windows.");const mod=await import("audify");aud=mod.default??mod}
function wavDecode(buf){
  if(buf.toString("ascii",0,4)!=="RIFF"||buf.toString("ascii",8,12)!=="WAVE")throw Error("Reference must be a WAV file.");
  let p=12,rate=0,channels=0,bits=0,data=null;
  while(p+8<=buf.length){const id=buf.toString("ascii",p,p+4),n=buf.readUInt32LE(p+4);p+=8;
    if(id==="fmt "){const format=buf.readUInt16LE(p);channels=buf.readUInt16LE(p+2);rate=buf.readUInt32LE(p+4);bits=buf.readUInt16LE(p+14);if(format!==1||bits!==16)throw Error("Only PCM 16-bit WAV is supported.")}
    if(id==="data"){data=buf.subarray(p,p+n);break}p+=n+(n&1)}
  if(!data||!rate||!channels)throw Error("Invalid WAV data.");
  const out=new Float32Array(Math.floor(data.length/(2*channels)));
  for(let i=0;i<out.length;i++){let s=0;for(let c=0;c<channels;c++)s+=data.readInt16LE((i*channels+c)*2)/32768;out[i]=s/channels}
  return {samples:out,rate};
}
function resample(x,a,b=RATE){
  if(a===b)return x;
  const n=Math.max(1,Math.round(x.length*b/a)),out=new Float32Array(n),scale=(x.length-1)/Math.max(1,n-1);
  for(let i=0;i<n;i++){const q=i*scale,j=Math.floor(q),f=q-j;out[i]=(x[j]??0)*(1-f)+(x[j+1]??x[j]??0)*f}
  return out;
}
function fft(re,im){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}
  for(let len=2;len<=n;len<<=1){const half=len>>1,ang=-2*Math.PI/len,wr0=Math.cos(ang),wi0=Math.sin(ang);
    for(let i=0;i<n;i+=len){let wr=1,wi=0;for(let j=0;j<half;j++){const u=i+j,v=u+half,tr=wr*re[v]-wi*im[v],ti=wr*im[v]+wi*re[v];re[v]=re[u]-tr;im[v]=im[u]-ti;re[u]+=tr;im[u]+=ti;const nr=wr*wr0-wi*wi0;wi=wr*wi0+wi0*0+wi*wr0;wr=nr}}
  }
}
function spectrogram(x){
  const N=1024,H=256,w=new Float32Array(N);
  for(let i=0;i<N;i++)w[i]=0.5-0.5*Math.cos(2*Math.PI*i/(N-1));
  const frames=Math.max(1,Math.floor((x.length-N)/H)+1),out=new Float32Array(frames*513);
  const re=new Float64Array(N),im=new Float64Array(N);
  for(let f=0;f<frames;f++){const off=f*H,base=f*513;
    for(let n=0;n<N;n++){re[n]=x[off+n]*w[n];im[n]=0}
    fft(re,im);
    for(let k=0;k<=512;k++)out[base+k]=Math.sqrt(re[k]*re[k]+im[k]*im[k]+1e-9);
  }
  return {data:out,frames};
}
async function embed(x){
  const s=spectrogram(x);return await embedSpec(s);
}
async function embedSpec(s){
  const o=await refModel.run({spec:new ort.Tensor("float32",s.data,[1,s.frames,513])});
  return Float32Array.from(o.tone_embedding.data);
}
async function convert(x){
  const s=spectrogram(x),src=await embedSpec(s);
  const o=await convModel.run({
    spec:new ort.Tensor("float32",s.data,[1,513,s.frames]),
    spec_lengths:new ort.Tensor("int64",BigInt64Array.from([BigInt(s.frames)]),[1]),
    src_g:new ort.Tensor("float32",src,[1,256,1]),
    tgt_g:new ort.Tensor("float32",target,[1,256,1])
  });
  return Float32Array.from(o.audio.data);
}
function pcm16ToFloat(buf){const x=new Float32Array(Math.floor(buf.length/2));for(let i=0;i<x.length;i++)x[i]=buf.readInt16LE(i*2)/32768;return x}
function floatToPcm16(x){const b=Buffer.alloc(x.length*2);for(let i=0;i<x.length;i++){const v=Math.max(-1,Math.min(1,x[i]));b.writeInt16LE(v<0?v*32768:v*32767,i*2)}return b}
function appendOutput(x){
  const y=resample(x,RATE,WASAPI_RATE);
  // Do not crossfade against the end of the queued buffer: that rewrites
  // already-scheduled audio and creates periodic thumps/clicks.
  // Keep chunks contiguous and let the model provide the voice continuity.
  outputQueue=Buffer.concat([outputQueue,floatToPcm16(y)]);
  const max=WASAPI_RATE*2*1.5;
  if(outputQueue.length>max)outputQueue=outputQueue.subarray(outputQueue.length-max);
}
function takeOutput(bytes){
  if(outputQueue.length>=bytes){const b=outputQueue.subarray(0,bytes);outputQueue=outputQueue.subarray(bytes);outputStarted=true;return b}
  if(!outputStarted){const b=Buffer.alloc(bytes);return b}
  underruns++;const b=Buffer.alloc(bytes);outputQueue.copy(b);outputQueue=Buffer.alloc(0);return b;
}
function emitStatus(text){if(activeSocket?.readyState===1)activeSocket.send(JSON.stringify({type:"status",text}))}
function clearSpeechTimer(){if(speechTimer){clearTimeout(speechTimer);speechTimer=null}}
function resetSpeechState(){
  clearSpeechTimer();speechActive=false;speechBuffer=[];speechSamples=0;speechGeneration++;
}
function pushPreBuffer(x){
  preBuffer.push(x);preSamples+=x.length;
  const max=Math.round(WASAPI_RATE*0.75);
  while(preSamples>max&&preBuffer.length){
    const first=preBuffer.shift();preSamples-=first.length;
  }
}
function appendSpeech(x){speechBuffer.push(x);speechSamples+=x.length}
function queueSpeechUtterance(generation){
  if(generation!==speechGeneration||speechSamples<Math.round(WASAPI_RATE*0.15))return;
  const all=new Float32Array(speechSamples);let p=0;
  for(const part of speechBuffer){all.set(part,p);p+=part.length}
  pendingQueue.push(all);
  if(pendingQueue.length>3)pendingQueue.splice(0,pendingQueue.length-3);
  speechBuffer=[];speechSamples=0;speechActive=false;
  emitStatus("OpenVoice is converting the completed speech...");
  void convertPending();
}
function finishSpeechLater(){
  clearSpeechTimer();
  const g=speechGeneration;
  speechTimer=setTimeout(()=>{speechTimer=null;queueSpeechUtterance(g)},250);
}
function handleDeepgramMessage(raw){
  let m;try{m=JSON.parse(raw.toString())}catch{return}
  if(m.type==="SpeechStarted"){
    if(!speechActive){
      speechGeneration++;
      speechBuffer=preBuffer.slice();
      speechSamples=preSamples;
      speechActive=true;
      emitStatus("Deepgram detected speech...");
    }
    clearSpeechTimer();
    return;
  }
  if(m.type==="Results"){
    const alt=m.channel?.alternatives?.[0];
    const text=alt?.transcript?.trim();
    if(text&&m.is_final)emitStatus("Deepgram: "+text);
    if(m.speech_final)finishSpeechLater();
  }
  if(m.type==="UtteranceEnd"&&m.last_word_end>=0)finishSpeechLater();
}
async function startDeepgram(key){
  if(!key)throw Error("Enter your Deepgram API key first.");
  if(deepgramWs){try{deepgramWs.close()}catch{}deepgramWs=null}
  deepgramKey=String(key).trim();
  const {WebSocket}=await import("ws");
  const url="wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&encoding=linear16&sample_rate="+WASAPI_RATE+"&channels=1&interim_results=true&vad_events=true&endpointing=300&utterance_end_ms=1000";
  await new Promise((resolve,reject)=>{
    const ws=new WebSocket(url,{headers:{Authorization:"Token "+deepgramKey}});
    let settled=false;
    ws.on("open",()=>{deepgramWs=ws;settled=true;emitStatus("Deepgram STT connected • waiting for speech");resolve()});
    ws.on("message",data=>handleDeepgramMessage(data));
    ws.on("error",err=>{if(!settled){settled=true;reject(Error("Deepgram connection failed: "+err.message))}else console.error("Deepgram:",err.message)});
    ws.on("close",()=>{if(deepgramWs===ws)deepgramWs=null;if(rtStarted)emitStatus("Deepgram STT disconnected")});
  });
}
async function stopDeepgram(){
  clearSpeechTimer();
  if(deepgramWs){try{deepgramWs.send(JSON.stringify({type:"CloseStream"}))}catch{}try{deepgramWs.close()}catch{}}
  deepgramWs=null;deepgramKey="";resetSpeechState();preBuffer=[];preSamples=0;
}
async function convertPending(){
  if(converting||pendingQueue.length===0)return;
  converting=true;
  const x=pendingQueue.shift();
  const started=performance.now();
  try{
    appendOutput(await convert(resample(x,WASAPI_RATE,RATE)));
    const ms=Math.round(performance.now()-started),sec=x.length/WASAPI_RATE;
    emitStatus("Converting • "+ms+" ms for "+Math.round(sec*1000)+" ms audio"+(ms>sec*1000?" • CPU is behind":""));
  }catch(e){
    console.error("conversion:",e);
    if(activeSocket?.readyState===1)activeSocket.send(JSON.stringify({type:"error",error:e.message}));
  }finally{
    converting=false;
    if(pendingQueue.length)void convertPending();
  }
}
function pushCapture(pcm){
  if(!rtStarted)return;
  const x=pcm16ToFloat(pcm);
  if(deepgramWs?.readyState===1)deepgramWs.send(pcm);
  pushPreBuffer(x);
  if(speechActive)appendSpeech(x);
}
function findDevice(list,id,kind){
  if(id!==null&&id!==undefined&&id!==""){const n=Number(id);if(Number.isFinite(n)&&list.some(d=>d.id===n))return n}
  const d=list.find(x=>kind==="input"?x.inputChannels>0:x.outputChannels>0);return d?.id;
}
async function devices(){await loadWasapi();const probe=new aud.RtAudio(aud.RtAudioApi.WINDOWS_WASAPI);const list=probe.getDevices();try{probe.closeStream?.()}catch{}return list}
async function stopWasapi(){
  if(rt){try{if(rtStarted)rt.stop()}catch{}try{rt.closeStream()}catch{}}
  rt=null;rtStarted=false;outputQueue=Buffer.alloc(0);outputStarted=false;underruns=0;pendingQueue=[];resetSpeechState();preBuffer=[];preSamples=0;
}
async function startWasapi(outId){
  await loadWasapi();await stopWasapi();const list=await devices();
  outputId=findDevice(list,outId,"output");
  if(outputId===undefined)throw Error("Could not find the WASAPI output device.");
  rt=new aud.RtAudio(aud.RtAudioApi.WINDOWS_WASAPI);
  rt.openStream(
    {deviceId:outputId,nChannels:1,firstChannel:0},
    null,
    aud.RtAudioFormat.RTAUDIO_SINT16,WASAPI_RATE,FRAME,"VoiceChanger",
    ()=>rt.write(takeOutput(FRAME*2))
  );
  rt.start();rtStarted=true;
  console.log("WASAPI output started. output="+outputId);
  emitStatus("WASAPI output ready • Electron is supplying microphone audio");
}
const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8"};
const server=http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS"){res.writeHead(204,{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type"});return res.end()}
  const pathname=decodeURIComponent(new URL(req.url||"/","http://127.0.0.1:"+PORT).pathname);
  if(pathname==="/health"&&req.method==="GET")return reply(res,200,{ok:true,models:!!(refModel&&convModel),voice:!!target,deepgram:!!deepgramWs,wasapi:process.platform==="win32",running:rtStarted,inputId,outputId,underruns});
  if(pathname==="/devices"&&req.method==="GET"){try{return reply(res,200,{ok:true,devices:await devices()})}catch(e){return reply(res,500,{ok:false,error:e.message})}}
  if(pathname==="/target"&&req.method==="POST"){try{const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));if(typeof body.wav!=="string"||!body.wav)throw Error("No WAV data was provided.");const wav=wavDecode(Buffer.from(body.wav,"base64"));await loadModels();target=await embed(resample(wav.samples,wav.rate));return reply(res,200,{ok:true})}catch(e){console.error(e);return reply(res,500,{ok:false,error:e.message})}}
  if(req.method==="GET"){
    const relative=pathname==="/"?"/index.html":pathname,file=path.resolve(ROOT,"."+relative),rootWithSep=ROOT.endsWith(path.sep)?ROOT:ROOT+path.sep;
    if((file===ROOT||file.startsWith(rootWithSep))&&file!==path.join(ROOT,"server.mjs")){try{const data=await fs.readFile(file);res.writeHead(200,{"Content-Type":MIME[path.extname(file).toLowerCase()]||"application/octet-stream","Cache-Control":"no-store"});return res.end(data)}catch{}}
  }
  reply(res,404,{ok:false,error:"Not found"});
});
server.listen(PORT,"127.0.0.1",async()=>{console.log("VoiceChanger ready: http://127.0.0.1:"+PORT);try{await loadWasapi();console.log("WASAPI audio backend ready.")}catch(e){console.error("WASAPI backend unavailable:",e.message)}});
(async()=>{
  try{
    const {WebSocketServer}=await import("ws");const wss=new WebSocketServer({server,path:"/audio"});
    wss.on("connection",ws=>{
      activeSocket=ws;
      ws.on("message",async raw=>{
        try{
          const m=JSON.parse(raw);
          if(m.type==="devices"){ws.send(JSON.stringify({type:"devices",devices:await devices()}));return}
          if(m.type==="start"){if(!target)throw Error("Load a reference WAV first.");await startWasapi(m.outputId);await startDeepgram(m.deepgramKey);if(!sourceSocket||sourceSocket.readyState!==1)throw Error("Electron audio source is not connected.");emitStatus("Deepgram STT ready • start speaking");return}
          if(m.type==="stop"){if(sourceSocket?.readyState===1)sourceSocket.send(JSON.stringify({type:"stop"}));await stopDeepgram();await stopWasapi();emitStatus("Stopped");return}
        }catch(e){console.error("audio:",e);if(ws.readyState===1)ws.send(JSON.stringify({type:"error",error:e.message}))}
      });
      ws.on("close",async()=>{if(activeSocket===ws){activeSocket=null;await stopDeepgram();await stopWasapi()}})
    });
  const sourceWss=new WebSocketServer({server,path:"/source"});
  sourceWss.on("connection",ws=>{
    sourceSocket=ws;
    ws.on("message",(raw,isBinary)=>{
      if(!isBinary){
        try{
          const m=JSON.parse(raw);
          if(m.type==="ready")emitStatus("Electron microphone active • "+(m.deviceName||"selected microphone"));
          if(m.type==="error"&&activeSocket?.readyState===1)activeSocket.send(JSON.stringify({type:"error",error:"Electron: "+m.error}));
        }catch{}
        return;
      }
      if(isBinary)pushCapture(Buffer.from(raw));
    });
    ws.on("close",()=>{if(sourceSocket===ws){sourceSocket=null;if(rtStarted)emitStatus("Electron audio source disconnected")}}});
  });
  }catch(e){console.error("WebSocket backend unavailable:",e.message)}
})();
