const http=require("http");
const fs=require("fs");
const path=require("path");
const url=require("url");
const WebSocket=require("ws");
const sherpa=require("sherpa-onnx-node");

const ROOT=__dirname;
const ASR=path.join(ROOT,"models","sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20");
const POCKET=path.join(ROOT,"models","sherpa-onnx-pocket-tts-int8-2026-01-26");
const REF=path.join(ROOT,"Recording (10).wav");
const PORT=8787;

let recognizer=null;
let ttsEngine=null;
let startupError=null;

function missingFiles(dir,names){
  return names.filter(name=>!fs.existsSync(path.join(dir,name)));
}
function validate(){
  const problems=[];
  if(!fs.existsSync(REF)) problems.push('Missing reference WAV: Recording (10).wav');
  const asr=['encoder-epoch-99-avg-1.int8.onnx','decoder-epoch-99-avg-1.onnx','joiner-epoch-99-avg-1.int8.onnx','tokens.txt'];
  const pocket=['lm_flow.int8.onnx','lm_main.int8.onnx','encoder.onnx','decoder.int8.onnx','text_conditioner.onnx','vocab.json','token_scores.json'];
  const a=missingFiles(ASR,asr); if(a.length) problems.push('Missing ASR model files: '+a.join(', '));
  const p=missingFiles(POCKET,pocket); if(p.length) problems.push('Missing PocketTTS model files: '+p.join(', '));
  return problems;
}

function initAsr(){
  recognizer=new sherpa.OnlineRecognizer({
    featConfig:{sampleRate:16000,featureDim:80},
    modelConfig:{
      transducer:{
        encoder:path.join(ASR,'encoder-epoch-99-avg-1.int8.onnx'),
        decoder:path.join(ASR,'decoder-epoch-99-avg-1.onnx'),
        joiner:path.join(ASR,'joiner-epoch-99-avg-1.int8.onnx')
      },
      tokens:path.join(ASR,'tokens.txt'),
      numThreads:2,
      provider:'cpu'
    },
    decodingMethod:'greedy_search',
    enableEndpoint:true,
    rule1MinTrailingSilence:1.0,
    rule2MinTrailingSilence:1.5,
    rule3MinUtteranceLength:0
  });
}

async function initTts(){
  const config={
    model:{
      pocket:{
        lmFlow:path.join(POCKET,'lm_flow.int8.onnx'),
        lmMain:path.join(POCKET,'lm_main.int8.onnx'),
        encoder:path.join(POCKET,'encoder.onnx'),
        decoder:path.join(POCKET,'decoder.int8.onnx'),
        textConditioner:path.join(POCKET,'text_conditioner.onnx'),
        vocabJson:path.join(POCKET,'vocab.json'),
        tokenScoresJson:path.join(POCKET,'token_scores.json'),
        voiceEmbeddingCacheCapacity:10
      },
      debug:false,
      numThreads:2,
      provider:'cpu'
    },
    maxNumSentences:1
  };
  ttsEngine=await sherpa.OfflineTts.createAsync(config);
}

const refWave=fs.existsSync(REF)?sherpa.readWave(REF):null;

function wav(samples,sampleRate){
  const data=Buffer.alloc(samples.length*2);
  for(let i=0;i<samples.length;i++){
    const v=Math.max(-1,Math.min(1,samples[i]));
    data.writeInt16LE(v<0?v*32768:v*32767,i*2);
  }
  const b=Buffer.alloc(44+data.length);
  b.write('RIFF',0);b.writeUInt32LE(36+data.length,4);b.write('WAVE',8);
  b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(sampleRate,24);b.writeUInt32LE(sampleRate*2,28);
  b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);
  b.writeUInt32LE(data.length,40);data.copy(b,44);return b;
}

async function synth(text){
  if(!ttsEngine) throw new Error(startupError||'PocketTTS is not ready.');
  const generationConfig=new sherpa.GenerationConfig({
    speed:1.0,
    referenceAudio:refWave.samples,
    referenceSampleRate:refWave.sampleRate,
    numSteps:5,
    extra:{max_reference_audio_len:10,seed:42}
  });
  const audio=ttsEngine.generate({text,generationConfig});
  return wav(audio.samples,audio.sampleRate);
}

function mime(p){
  if(p.endsWith('.html'))return'text/html; charset=utf-8';
  if(p.endsWith('.js'))return'application/javascript; charset=utf-8';
  if(p.endsWith('.css'))return'text/css; charset=utf-8';
  return'application/octet-stream';
}

const server=http.createServer((req,res)=>{
  const u=url.parse(req.url,true);

  if(u.pathname==='/health'){
    const ready=!!recognizer&&!!ttsEngine&&!startupError;
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({
      ok:ready,
      stt:!!recognizer,
      tts:!!ttsEngine,
      reference:fs.existsSync(REF),
      error:startupError
    }));
  }

  if(u.pathname==='/tts'&&req.method==='POST'){
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',async()=>{
      try{
        const text=(JSON.parse(body).text||'').trim().slice(0,500);
        if(!text) throw new Error('No text received.');
        const out=await synth(text);
        res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store'});
        res.end(out);
      }catch(e){
        res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});
        res.end(String(e.stack||e));
      }
    });
    return;
  }

  try{
    let p=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname.slice(1));
    p=path.resolve(ROOT,p);
    if(!p.startsWith(path.resolve(ROOT))||!fs.existsSync(p)||!fs.statSync(p).isFile()){
      res.writeHead(404);return res.end('Not found');
    }
    res.writeHead(200,{'Content-Type':mime(p)});
    fs.createReadStream(p).pipe(res);
  }catch(e){
    res.writeHead(500);res.end(String(e.stack||e));
  }
});

const wss=new WebSocket.Server({server,path:'/audio'});
wss.on('connection',ws=>{
  if(!recognizer){
    ws.send(JSON.stringify({type:'error',message:startupError||'STT is not ready.'}));
    return;
  }
  const stream=recognizer.createStream();
  ws.on('message',(data,isBinary)=>{
    if(!isBinary)return;
    try{
      const buf=Buffer.from(data);
      const samples=new Float32Array(buf.buffer,buf.byteOffset,Math.floor(buf.byteLength/4));
      stream.acceptWaveform({samples,sampleRate:16000});
      while(recognizer.isReady(stream)) recognizer.decode(stream);
      const r=recognizer.getResult(stream);
      if(r.text) ws.send(JSON.stringify({type:'partial',text:r.text}));
      if(recognizer.isEndpoint(stream)){
        if(r.text) ws.send(JSON.stringify({type:'final',text:r.text}));
        recognizer.reset(stream);
      }
    }catch(e){
      ws.send(JSON.stringify({type:'error',message:String(e.message||e)}));
    }
  });
});

server.listen(PORT,()=>{
  console.log('Local voice agent: http://127.0.0.1:'+PORT);
  const problems=validate();
  if(problems.length){
    startupError=problems.join('\n');
    console.error('\nSETUP ERROR:\n'+startupError);
    return;
  }
  try{
    initAsr();
    console.log('Local STT ready.');
  }catch(e){
    startupError='STT initialization failed: '+String(e.stack||e);
    console.error(startupError);
    return;
  }
  initTts().then(()=>{
    console.log('PocketTTS ready. Reference voice: Recording (10).wav');
  }).catch(e=>{
    startupError='PocketTTS initialization failed: '+String(e.stack||e);
    console.error(startupError);
  });
});