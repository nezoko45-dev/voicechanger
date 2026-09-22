import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import * as ort from "onnxruntime-node";
import {WebSocketServer} from "ws";

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const PORT=8765;
const RATE=22050;
const MODEL_DIR=path.join(ROOT,"models");
const BASE="https://huggingface.co/TigreGotico/voiceclonnx-openvoice-v2/resolve/main/";
const FILES={ref:"tone_ref_encoder_q8.onnx",conv:"tone_converter_q8.onnx"};

let refModel=null,convModel=null,target=null,loading=null;

function reply(res,status,data){
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type"});
  res.end(JSON.stringify(data));
}

async function getModel(kind){
  await fs.mkdir(MODEL_DIR,{recursive:true});
  const name=FILES[kind],file=path.join(MODEL_DIR,name);
  try{await fs.access(file);return file;}catch{}
  console.log("Downloading "+name+"...");
  const r=await fetch(BASE+name+"?download=true");
  if(!r.ok)throw new Error("Could not download "+name+" ("+r.status+")");
  const tmp=file+".tmp";
  const h=await fs.open(tmp,"w");
  try{for await(const chunk of r.body)await h.write(chunk);}
  finally{await h.close();}
  await fs.rename(tmp,file);
  return file;
}

async function loadModels(){
  if(refModel&&convModel)return;
  if(loading)return loading;
  loading=(async()=>{
    const [a,b]=await Promise.all([getModel("ref"),getModel("conv")]);
    console.log("Loading OpenVoice ONNX...");
    refModel=await ort.InferenceSession.create(a,{executionProviders:["cpu"]});
    convModel=await ort.InferenceSession.create(b,{executionProviders:["cpu"]});
    console.log("OpenVoice ONNX ready.");
  })().finally(()=>loading=null);
  return loading;
}

function wavDecode(buf){
  if(buf.toString("ascii",0,4)!=="RIFF"||buf.toString("ascii",8,12)!=="WAVE")throw new Error("Reference must be a WAV file.");
  let p=12,rate=0,channels=0,bits=0,data=null;
  while(p+8<=buf.length){
    const id=buf.toString("ascii",p,p+4),n=buf.readUInt32LE(p+4); p+=8;
    if(id==="fmt "){
      const format=buf.readUInt16LE(p);
      channels=buf.readUInt16LE(p+2);
      rate=buf.readUInt32LE(p+4);
      bits=buf.readUInt16LE(p+14);
      if(format!==1||bits!==16)throw new Error("Only PCM 16-bit WAV is supported.");
    }
    if(id==="data"){data=buf.subarray(p,p+n);break;}
    p+=n+(n&1);
  }
  if(!data||!rate||!channels)throw new Error("Invalid WAV data.");
  const out=new Float32Array(Math.floor(data.length/(2*channels)));
  for(let i=0;i<out.length;i++){
    let s=0;
    for(let c=0;c<channels;c++)s+=data.readInt16LE((i*channels+c)*2)/32768;
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

function spectrogram(x){
  const N=1024,H=256,P=384;
  const w=new Float32Array(N);
  for(let i=0;i<N;i++)w[i]=0.5-0.5*Math.cos(2*Math.PI*i/(N-1));
  const pad=new Float32Array(x.length+P*2);
  for(let i=0;i<P;i++){
    pad[P-1-i]=x[Math.min(i,x.length-1)]??0;
    pad[P+x.length+i]=x[Math.max(0,x.length-1-i)]??0;
  }
  pad.set(x,P);
  const frames=Math.max(1,Math.floor((pad.length-N)/H)+1),out=new Float32Array(frames*513);
  for(let f=0;f<frames;f++){
    const off=f*H,base=f*513;
    for(let k=0;k<=512;k++){
      let re=0,im=0;
      for(let n=0;n<N;n++){
        const a=2*Math.PI*k*n/N,v=pad[off+n]*w[n];
        re+=v*Math.cos(a);
        im-=v*Math.sin(a);
      }
      out[base+k]=Math.sqrt(re*re+im*im+1e-6);
    }
  }
  return {data:out,frames};
}

async function embed(x){
  const s=spectrogram(x);
  const o=await refModel.run({spec:new ort.Tensor("float32",s.data,[1,s.frames,513])});
  return Float32Array.from(o.tone_embedding.data);
}

function encodeWav(x,rate){
  const b=Buffer.alloc(44+x.length*2);
  b.write("RIFF",0);
  b.writeUInt32LE(36+x.length*2,4);
  b.write("WAVE",8);
  b.write("fmt ",12);
  b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20);
  b.writeUInt16LE(1,22);
  b.writeUInt32LE(rate,24);
  b.writeUInt32LE(rate*2,28);
  b.writeUInt16LE(2,32);
  b.writeUInt16LE(16,34);
  b.write("data",36);
  b.writeUInt32LE(x.length*2,40);
  for(let i=0;i<x.length;i++){
    const v=Math.max(-1,Math.min(1,x[i]));
    b.writeInt16LE(v<0?v*32768:v*32767,44+i*2);
  }
  return b;
}

async function convert(x){
  const s=spectrogram(x),src=await embed(x);
  const o=await convModel.run({
    spec:new ort.Tensor("float32",s.data,[1,513,s.frames]),
    spec_lengths:new ort.Tensor("int64",BigInt64Array.from([BigInt(s.frames)]),[1]),
    src_g:new ort.Tensor("float32",src,[1,256,1]),
    tgt_g:new ort.Tensor("float32",target,[1,256,1])
  });
  return Float32Array.from(o.audio.data);
}

const MIME={
  ".html":"text/html; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".ico":"image/x-icon"
};

const server=http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS"){
    res.writeHead(204,{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type"});
    return res.end();
  }

  const url=new URL(req.url||"/","http://127.0.0.1:"+PORT);
  const pathname=decodeURIComponent(url.pathname);

  if(pathname==="/health"&&req.method==="GET"){
    return reply(res,200,{ok:true,models:!!(refModel&&convModel),voice:!!target});
  }

  if(pathname==="/target"&&req.method==="POST"){
    try{
      const chunks=[];
      for await(const c of req)chunks.push(c);
      const body=JSON.parse(Buffer.concat(chunks));
      if(typeof body.wav!=="string"||!body.wav)throw new Error("No WAV data was provided.");
      const wav=wavDecode(Buffer.from(body.wav,"base64"));
      await loadModels();
      target=await embed(resample(wav.samples,wav.rate));
      return reply(res,200,{ok:true});
    }catch(e){
      console.error(e);
      return reply(res,500,{ok:false,error:e.message});
    }
  }

  if(req.method==="GET"){
    const relative=pathname==="/"?"/index.html":pathname;
    const file=path.resolve(ROOT,"."+relative);
    const rootWithSep=ROOT.endsWith(path.sep)?ROOT:ROOT+path.sep;
    if((file===ROOT||file.startsWith(rootWithSep))&&file!==path.join(ROOT,"server.mjs")){
      try{
        const data=await fs.readFile(file);
        res.writeHead(200,{"Content-Type":MIME[path.extname(file).toLowerCase()]||"application/octet-stream","Cache-Control":"no-store"});
        return res.end(data);
      }catch{}
    }
  }

  reply(res,404,{ok:false,error:"Not found"});
});

const wss=new WebSocketServer({server,path:"/audio"});
wss.on("connection",ws=>{
  let busy=Promise.resolve();
  ws.on("message",raw=>{
    busy=busy.then(async()=>{
      try{
        const m=JSON.parse(raw);
        if(m.type!=="audio")return;
        if(!target)throw new Error("Load a reference voice first.");
        const wav=wavDecode(Buffer.from(m.wav,"base64"));
        const x=resample(wav.samples,wav.rate);
        if(x.length<4096)return;
        const y=await convert(x);
        const out=encodeWav(y,RATE).toString("base64");
        if(ws.readyState===1)ws.send(JSON.stringify({type:"audio",wav:out}));
      }catch(e){
        console.error("conversion:",e.message);
        if(ws.readyState===1)ws.send(JSON.stringify({type:"error",error:e.message}));
      }
    });
  });
});

server.listen(PORT,"127.0.0.1",()=>console.log("VoiceChanger ready: http://127.0.0.1:"+PORT));
