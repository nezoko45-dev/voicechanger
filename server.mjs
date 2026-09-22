import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PORT=8765;
const RATE=22050;
const AUDIO_RATE=48000;
const FRAME=1920;
const CONVERT_FRAMES=Math.round(AUDIO_RATE*0.60);
const MODEL_DIR=path.join(ROOT,"models");
const BASE="https://huggingface.co/TigreGotico/voiceclonnx-openvoice-v2/resolve/main/";
const FILES={ref:"tone_ref_encoder_q8.onnx",conv:"tone_converter_q8.onnx"};

let ort=null,refModel=null,convModel=null,target=null,loading=null;
let aud=null,rt=null,running=false,inputId=null,outputId=null;
let captureParts=[],captureSamples=0,pendingQueue=[],converting=false;
let outputQueue=Buffer.alloc(0),outputStarted=false,underruns=0;

function reply(res,status,data){
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type"});
  res.end(JSON.stringify(data));
}
async function readJson(req){
  const chunks=[];for await(const c of req)chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")||"{}");
}
async function getModel(kind){
  await fs.mkdir(MODEL_DIR,{recursive:true});
  const name=FILES[kind],file=path.join(MODEL_DIR,name);
  try{await fs.access(file);return file}catch{}
  console.log("Downloading "+name+"...");
  const r=await fetch(BASE+name+"?download=true");
  if(!r.ok)throw Error("Could not download "+name+" ("+r.status+")");
  const tmp=file+".tmp",h=await fs.open(tmp,"w");
  try{for await(const chunk of r.body)await h.write(chunk)}
  finally{await h.close()}
  await fs.rename(tmp,file);return file;
}
async function loadModels(){
  if(!ort)ort=await import("onnxruntime-node");
  if(refModel&&convModel)return;
  if(loading)return loading;
  loading=(async()=>{
    const [a,b]=await Promise.all([getModel("ref"),getModel("conv")]);
    const threads=Math.max(1,Math.min(8,(Number(process.env.NUMBER_OF_PROCESSORS)||4)-1));
    const options={executionProviders:["cpu"],intraOpNumThreads:threads,interOpNumThreads:1};
    console.log("Loading OpenVoice V2 ONNX...");
    refModel=await ort.InferenceSession.create(a,options);
    convModel=await ort.InferenceSession.create(b,options);
    console.log("OpenVoice V2 ONNX ready.");
  })().finally(()=>loading=null);
  return loading;
}
async function loadAudio(){
  if(aud)return;
  if(process.platform!=="win32")throw Error("This simple audio mode requires Windows.");
  const mod=await import("audify");aud=mod.default??mod;
}
function wavDecode(buf){
  if(buf.toString("ascii",0,4)!=="RIFF"||buf.toString("ascii",8,12)!=="WAVE")throw Error("Reference must be a WAV file.");
  let p=12,rate=0,channels=0,bits=0,data=null;
  while(p+8<=buf.length){
    const id=buf.toString("ascii",p,p+4),n=buf.readUInt32LE(p+4);p+=8;
    if(id==="fmt "){
      const format=buf.readUInt16LE(p);channels=buf.readUInt16LE(p+2);rate=buf.readUInt32LE(p+4);bits=buf.readUInt16LE(p+14);
      if(format!==1||bits!==16)throw Error("Only PCM 16-bit WAV is supported.");
    }
    if(id==="data"){data=buf.subarray(p,p+n);break}
    p+=n+(n&1);
  }
  if(!data||!rate||!channels)throw Error("Invalid WAV data.");
  const out=new Float32Array(Math.floor(data.length/(2*channels)));
  for(let i=0;i<out.length;i++){
    let s=0;for(let c=0;c<channels;c++)s+=data.readInt16LE((i*channels+c)*2)/32768;
    out[i]=s/channels;
  }
  return {samples:out,rate};
}
function resample(x,a,b=RATE){
  if(a===b)return x;
  const n=Math.max(1,Math.round(x.length*b/a)),out=new Float32Array(n),scale=(x.length-1)/Math.max(1,n-1);
  for(let i=0;i<n;i++){
    const q=i*scale,j=Math.floor(q),f=q-j;
    out[i]=(x[j]??0)*(1-f)+(x[j+1]??x[j]??0)*f;
  }
  return out;
}
function fft(re,im){
  const n=re.length;
  for(let i=1,j=0;i<n;i++){
    let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
    if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}
  }
  for(let len=2;len<=n;len<<=1){
    const half=len>>1,ang=-2*Math.PI/len,wr0=Math.cos(ang),wi0=Math.sin(ang);
    for(let i=0;i<n;i+=len){
      let wr=1,wi=0;
      for(let j=0;j<half;j++){
        const u=i+j,v=u+half,tr=wr*re[v]-wi*im[v],ti=wr*im[v]+wi*re[v];
        re[v]=re[u]-tr;im[v]=im[u]-ti;re[u]+=tr;im[u]+=ti;
        const nr=wr*wr0-wi*wi0;wi=wr*wi0+wi*wr0;wr=nr;
      }
    }
  }
}
function spectrogram(x){
  const N=1024,H=256,P=384;
  const w=new Float32Array(N);
  for(let i=0;i<N;i++)w[i]=0.5-0.5*Math.cos(2*Math.PI*i/(N-1));
  const padded=new Float32Array(x.length+P*2);
  padded.set(x,P);
  const frames=Math.max(1,Math.floor((padded.length-N)/H)+1);
  const out=new Float32Array(frames*513);
  const re=new Float64Array(N),im=new Float64Array(N);
  for(let f=0;f<frames;f++){
    const off=f*H,base=f*513;
    for(let n=0;n<N;n++){re[n]=padded[off+n]*w[n];im[n]=0}
    fft(re,im);
    for(let k=0;k<=512;k++)out[base+k]=Math.sqrt(re[k]*re[k]+im[k]*im[k]+1e-6);
  }
  return {data:out,frames};
}
async function embedSpec(s){
  const o=await refModel.run({spec:new ort.Tensor("float32",s.data,[1,s.frames,513])});
  return Float32Array.from(o.tone_embedding.data);
}
async function embed(x){return embedSpec(spectrogram(x))}
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
function pcm16ToFloat(buf){
  const x=new Float32Array(Math.floor(buf.length/2));
  for(let i=0;i<x.length;i++)x[i]=buf.readInt16LE(i*2)/32768;
  return x;
}
function floatToPcm16(x){
  const b=Buffer.alloc(x.length*2);
  for(let i=0;i<x.length;i++){const v=Math.max(-1,Math.min(1,x[i]));b.writeInt16LE(v<0?v*32768:v*32767,i*2)}
  return b;
}
function appendOutput(x){
  outputQueue=Buffer.concat([outputQueue,floatToPcm16(resample(x,RATE,AUDIO_RATE))]);
}
function takeOutput(bytes){
  if(outputQueue.length>=bytes){
    const b=outputQueue.subarray(0,bytes);outputQueue=outputQueue.subarray(bytes);outputStarted=true;return b;
  }
  if(!outputStarted)return Buffer.alloc(bytes);
  underruns++;
  const b=Buffer.alloc(bytes);outputQueue.copy(b);outputQueue=Buffer.alloc(0);return b;
}
function resetCapture(){captureParts=[];captureSamples=0}
function queueCapture(){
  const needed=CONVERT_FRAMES;
  while(captureSamples>=needed){
    const bytesNeeded=needed*2;
    const all=Buffer.concat(captureParts);
    const chunk=all.subarray(0,bytesNeeded);
    const remain=all.subarray(bytesNeeded);
    captureParts=remain.length?[remain]:[];
    captureSamples-=needed;
    pendingQueue.push(pcm16ToFloat(chunk));
  }
  void convertPending();
}
function onInput(pcm){
  if(!running)return;
  captureParts.push(Buffer.from(pcm));
  captureSamples+=Math.floor(pcm.length/2);
  if(captureSamples>=CONVERT_FRAMES)queueCapture();
  // Audify's realtime stream is driven by the input callback.
  // Feed the converted PCM into the same RtAudio stream here.
  // This matches Audify's documented realtime input/output pattern.
  try{rt?.write(takeOutput(FRAME*2))}catch(e){console.error("Audio output:",e.message)}
}
async function convertPending(){
  if(converting||pendingQueue.length===0)return;
  converting=true;
  const x=pendingQueue.shift();
  const started=performance.now();
  try{
    appendOutput(await convert(resample(x,AUDIO_RATE,RATE)));
    const ms=Math.round(performance.now()-started);
    console.log("OpenVoice: "+ms+" ms for "+Math.round(x.length/AUDIO_RATE*1000)+" ms audio");
  }catch(e){console.error("OpenVoice conversion:",e)}
  finally{converting=false;if(pendingQueue.length)void convertPending()}
}
function inputChannels(d){return Number(d?.inputChannels??d?.maxInputChannels??0)}
function outputChannels(d){return Number(d?.outputChannels??d?.maxOutputChannels??0)}
function deviceId(list,value,kind){
  const n=Number(value);
  if(Number.isFinite(n)&&list.some(d=>Number(d.id)===n))return n;
  const d=list.find(x=>kind==="input"?inputChannels(x)>0:outputChannels(x)>0);
  return d?.id;
}
function findVoicemeeter(list){
  const candidates=list.filter(d=>outputChannels(d)>0&&String(d.name||"").toLowerCase().includes("voicemeeter"));
  const score=d=>{
    const n=String(d.name||"").toLowerCase();
    if(n.includes("voicemeeter input"))return 100;
    if(n.includes("voicemeeter aux input"))return 95;
    if(/voicemeeter\s+(in\s*\d+|vaio3\s+input)/.test(n))return 90;
    return 50;
  };
  candidates.sort((a,b)=>score(b)-score(a));
  return candidates[0]?.id;
}
async function devices(){
  await loadAudio();
  const probe=new aud.RtAudio(aud.RtAudioApi.WINDOWS_WASAPI);
  try{return probe.getDevices()}finally{try{probe.closeStream?.()}catch{}}
}
async function stopAudio(){
  running=false;
  if(rt){try{rt.stop()}catch{}try{rt.closeStream()}catch{}}
  rt=null;resetCapture();pendingQueue=[];outputQueue=Buffer.alloc(0);outputStarted=false;underruns=0;inputId=null;outputId=null;
}
async function startAudio(inId,outId){
  await loadAudio();await stopAudio();
  const list=await devices();
  inputId=deviceId(list,inId,"input");
  outputId=deviceId(list,outId,"output");
  if(inputId===undefined)throw Error("No microphone input device was found.");
  if(outputId===undefined)throw Error("No output device was found.");
  if(!target)throw Error("Load a reference WAV first.");
  rt=new aud.RtAudio(aud.RtAudioApi.WINDOWS_WASAPI);
  rt.openStream(
    {deviceId:outputId,nChannels:1,firstChannel:0},
    {deviceId:inputId,nChannels:1,firstChannel:0},
    aud.RtAudioFormat.RTAUDIO_SINT16,AUDIO_RATE,FRAME,"VoiceChanger",
    pcm=>onInput(pcm)
  );
  rt.start();running=true;
  console.log("VoiceChanger audio started. Mic="+inputId+" Output="+outputId);
}
const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8"};
const server=http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS"){res.writeHead(204,{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type"});return res.end()}
  const pathname=decodeURIComponent(new URL(req.url||"/","http://127.0.0.1:"+PORT).pathname);
  if(pathname==="/health"&&req.method==="GET")return reply(res,200,{ok:true,models:!!(refModel&&convModel),voice:!!target,running,wasapi:process.platform==="win32",inputId,outputId,underruns});
  if(pathname==="/devices"&&req.method==="GET"){
    try{
      const list=await devices();
      return reply(res,200,{ok:true,devices:list,voicemeeterId:findVoicemeeter(list)});
    }catch(e){return reply(res,500,{ok:false,error:e.message})}
  }
  if(pathname==="/target"&&req.method==="POST"){
    try{
      const body=await readJson(req);if(typeof body.wav!=="string"||!body.wav)throw Error("No WAV data was provided.");
      const wav=wavDecode(Buffer.from(body.wav,"base64"));await loadModels();
      target=await embed(resample(wav.samples,wav.rate));
      return reply(res,200,{ok:true});
    }catch(e){console.error(e);return reply(res,500,{ok:false,error:e.message})}
  }
  if(pathname==="/start"&&req.method==="POST"){
    try{
      const body=await readJson(req);await loadModels();await startAudio(body.inputId,body.outputId);
      return reply(res,200,{ok:true,inputId,outputId});
    }catch(e){console.error(e);await stopAudio();return reply(res,500,{ok:false,error:e.message})}
  }
  if(pathname==="/stop"&&req.method==="POST"){await stopAudio();return reply(res,200,{ok:true})}
  if(req.method==="GET"){
    const relative=pathname==="/"?"/index.html":pathname,file=path.resolve(ROOT,"."+relative),rootWithSep=ROOT.endsWith(path.sep)?ROOT:ROOT+path.sep;
    if((file===ROOT||file.startsWith(rootWithSep))&&file!==path.join(ROOT,"server.mjs")){
      try{const data=await fs.readFile(file);res.writeHead(200,{"Content-Type":MIME[path.extname(file).toLowerCase()]||"application/octet-stream","Cache-Control":"no-store"});return res.end(data)}catch{}
    }
  }
  reply(res,404,{ok:false,error:"Not found"});
});
server.listen(PORT,"127.0.0.1",async()=>{console.log("VoiceChanger ready: http://127.0.0.1:"+PORT);try{await loadAudio();console.log("WASAPI audio backend ready.")}catch(e){console.error("Audio backend unavailable:",e.message)}});