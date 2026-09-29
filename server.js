const http=require("http");
const fs=require("fs");
const path=require("path");
const WebSocket=require("ws");
const Speaker=require("speaker");

const ROOT=__dirname;
const PORT=8787;
const AUDIO_PORT=8788;
const SAMPLE_RATE=24000;
const CHANNELS=1;

const httpServer=http.createServer((req,res)=>{
 const u=new URL(req.url,"http://127.0.0.1");
 if(u.pathname==="/health"){
  res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
  return res.end(JSON.stringify({ok:true,audioBackend:"node-speaker",audioPort:AUDIO_PORT}));
 }
 let file;
 try{file=u.pathname==="/"?"index.html":decodeURIComponent(u.pathname.slice(1));}
 catch{return res.writeHead(400).end();}
 const full=path.resolve(ROOT,file);
 if(!full.startsWith(path.resolve(ROOT))||!fs.existsSync(full)||fs.statSync(full).isDirectory()){
  res.writeHead(404);return res.end("Not found");
 }
 const ext=path.extname(full).toLowerCase();
 const types={".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",".json":"application/json",".wav":"audio/wav"};
 res.writeHead(200,{"Content-Type":types[ext]||"application/octet-stream","Cache-Control":"no-store"});
 fs.createReadStream(full).pipe(res);
});

const wss=new WebSocket.Server({port:AUDIO_PORT,host:"127.0.0.1"});
let speaker=null;

function ensureSpeaker(){
 if(speaker)return speaker;
 speaker=new Speaker({
  channels:CHANNELS,
  bitDepth:16,
  sampleRate:SAMPLE_RATE,
  signed:true
 });
 speaker.on("error",e=>console.error("Windows audio error:",e.message));
 return speaker;
}

wss.on("connection",ws=>{
 console.log("Audio client connected.");
 ws.on("message",(data,isBinary)=>{
  if(!isBinary)return;
  const input=Buffer.from(data);
  const count=Math.floor(input.length/4);
  if(!count)return;
  const pcm16=Buffer.allocUnsafe(count*2);
  for(let i=0;i<count;i++){
   let x=input.readFloatLE(i*4);
   if(!Number.isFinite(x))x=0;
   if(x>1)x=1;if(x<-1)x=-1;
   pcm16.writeInt16LE(Math.round(x*32767),i*2);
  }
  ensureSpeaker().write(pcm16);
 });
 ws.on("close",()=>console.log("Audio client disconnected."));
 ws.on("error",e=>console.error("Audio socket error:",e.message));
});

httpServer.listen(PORT,"127.0.0.1",()=>{
 console.log("PocketTTS local app: http://127.0.0.1:"+PORT);
 console.log("Local Windows audio backend: ws://127.0.0.1:"+AUDIO_PORT);
 console.log("Audio output uses the Windows default playback device.");
});
