const http=require("http");
const fs=require("fs");
const path=require("path");
const sherpa=require("sherpa-onnx-node");

const ROOT=__dirname;
const POCKET=path.join(ROOT,"models","sherpa-onnx-pocket-tts-int8-2026-01-26");
const ASR=path.join(ROOT,"models","sherpa-onnx-whisper-tiny.en");
const REF=path.join(ROOT,"Recording (10).wav");
const PORT=8787;

async function createScribeToken(apiKey){
  const r=await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",{
    method:"POST",
    headers:{"xi-api-key":apiKey}
  });
  const text=await r.text();
  let data={};
  try{data=JSON.parse(text)}catch{}
  if(!r.ok)throw new Error("ElevenLabs token request failed ("+r.status+"): "+(data.detail||text.slice(0,500)));
  if(!data.token)throw new Error("ElevenLabs returned no realtime Scribe token.");
  return data.token;
}

let tts=null,recognizer=null,error=null,reference=null;
const pocketFiles=["lm_flow.int8.onnx","lm_main.int8.onnx","encoder.onnx","decoder.int8.onnx","text_conditioner.onnx","vocab.json","token_scores.json"];
const asrFiles=["tiny.en-encoder.int8.onnx","tiny.en-decoder.int8.onnx","tiny.en-tokens.txt"];

function validate(){
  const missing=[];
  for(const f of pocketFiles)if(!fs.existsSync(path.join(POCKET,f)))missing.push("PocketTTS/"+f);
  for(const f of asrFiles)if(!fs.existsSync(path.join(ASR,f)))missing.push("ASR/"+f);
  if(!fs.existsSync(REF))missing.push("Recording (10).wav");
  return missing;
}

async function init(){
  const missing=validate();
  if(missing.length){error="Missing local files: "+missing.join(", ");return}
  reference=sherpa.readWave(REF);

  tts=await sherpa.OfflineTts.createAsync({
    model:{pocket:{
      lmFlow:path.join(POCKET,"lm_flow.int8.onnx"),
      lmMain:path.join(POCKET,"lm_main.int8.onnx"),
      encoder:path.join(POCKET,"encoder.onnx"),
      decoder:path.join(POCKET,"decoder.int8.onnx"),
      textConditioner:path.join(POCKET,"text_conditioner.onnx"),
      vocabJson:path.join(POCKET,"vocab.json"),
      tokenScoresJson:path.join(POCKET,"token_scores.json"),
      voiceEmbeddingCacheCapacity:10
    },debug:false,numThreads:2,provider:"cpu"},
    maxNumSentences:1
  });

  recognizer=new sherpa.OfflineRecognizer({
    featConfig:{sampleRate:16000,featureDim:80},
    modelConfig:{
      whisper:{
        encoder:path.join(ASR,"tiny.en-encoder.int8.onnx"),
        decoder:path.join(ASR,"tiny.en-decoder.int8.onnx"),
        language:"en",
        task:"transcribe"
      },
      tokens:path.join(ASR,"tiny.en-tokens.txt"),
      numThreads:2,
      provider:"cpu"
    },
    decodingMethod:"greedy_search"
  });
}

function makeWav(samples,sampleRate){
  const data=Buffer.alloc(samples.length*2);
  for(let i=0;i<samples.length;i++){
    const v=Math.max(-1,Math.min(1,samples[i]));
    data.writeInt16LE(v<0?v*32768:v*32767,i*2);
  }
  const out=Buffer.alloc(44+data.length);
  out.write("RIFF",0);out.writeUInt32LE(36+data.length,4);out.write("WAVE",8);
  out.write("fmt ",12);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);
  out.writeUInt32LE(sampleRate,24);out.writeUInt32LE(sampleRate*2,28);
  out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write("data",36);
  out.writeUInt32LE(data.length,40);data.copy(out,44);return out;
}

function synth(text){
  if(!tts)throw new Error(error||"PocketTTS is not ready.");
  const config=new sherpa.GenerationConfig({
    speed:1,referenceAudio:reference.samples,referenceSampleRate:reference.sampleRate,
    numSteps:5,extra:{max_reference_audio_len:10,seed:42}
  });
  const audio=tts.generate({text,generationConfig:config});
  return makeWav(audio.samples,audio.sampleRate);
}

async function recognize(samples,sampleRate){
  if(!recognizer)throw new Error(error||"Local STT is not ready.");
  const stream=recognizer.createStream();
  stream.acceptWaveform({samples:Float32Array.from(samples),sampleRate});
  stream.inputFinished();
  await recognizer.decode(stream);
  return recognizer.getResult(stream).text||"";
}

const server=http.createServer((req,res)=>{
  const u=new URL(req.url,"http://127.0.0.1");
  if(u.pathname==="/scribe-token"&&req.method==="POST"){
    let body="";
    req.on("data",c=>{body+=c;if(body.length>10000)req.destroy()});
    req.on("end",async()=>{
      try{
        const j=JSON.parse(body||"{}");
        const apiKey=String(j.apiKey||"").trim();
        if(!apiKey)throw new Error("Missing ElevenLabs API key.");
        const token=await createScribeToken(apiKey);
        res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
        res.end(JSON.stringify({token}));
      }catch(e){
        res.writeHead(500,{"Content-Type":"application/json","Cache-Control":"no-store"});
        res.end(JSON.stringify({error:e.message||"Scribe token error."}));
      }
    });
    return;
  }
  const u=new URL(req.url,"http://127.0.0.1");
  if(u.pathname==="/health"){
    res.writeHead(200,{"Content-Type":"application/json"});
    return res.end(JSON.stringify({ok:!!tts&&!!recognizer&&!error,tts:!!tts,stt:!!recognizer,reference:!!reference,error}));
  }

  if(u.pathname==="/stt"&&req.method==="POST"){
    let body="";req.on("data",c=>{body+=c;if(body.length>25e6)req.destroy()});
    req.on("end",async()=>{
      try{
        const j=JSON.parse(body),samples=Array.isArray(j.samples)?j.samples:[],rate=Number(j.sampleRate)||16000;
        if(!samples.length)throw new Error("No microphone audio received.");
        if(samples.length>16000*15)throw new Error("Recording is too long.");
        const text=await recognize(samples,rate);
        res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
        res.end(JSON.stringify({text}));
      }catch(e){
        res.writeHead(500,{"Content-Type":"text/plain; charset=utf-8"});
        res.end(String(e.stack||e));
      }
    });return;
  }

  if(u.pathname==="/tts"&&req.method==="POST"){
    let body="";req.on("data",c=>body+=c);
    req.on("end",()=>{
      try{
        const value=String(JSON.parse(body).text||"").trim().slice(0,500);
        if(!value)throw new Error("No text received.");
        const wav=synth(value);
        res.writeHead(200,{"Content-Type":"audio/wav","Cache-Control":"no-store"});
        res.end(wav);
      }catch(e){
        res.writeHead(500,{"Content-Type":"text/plain; charset=utf-8"});res.end(String(e.stack||e));
      }
    });return;
  }

  const file=u.pathname==="/"?"index.html":decodeURIComponent(u.pathname.slice(1));
  const full=path.resolve(ROOT,file);
  if(!full.startsWith(path.resolve(ROOT))||!fs.existsSync(full)){res.writeHead(404);return res.end("Not found")}
  const type=full.endsWith(".html")?"text/html; charset=utf-8":"application/javascript; charset=utf-8";
  res.writeHead(200,{"Content-Type":type});fs.createReadStream(full).pipe(res);
});

server.listen(PORT,async()=>{
  console.log("Local PocketTTS Echo: http://127.0.0.1:"+PORT);
  try{await init();console.log("Local STT + PocketTTS ready.")}catch(e){error=String(e.stack||e);console.error(error)}
});