const $=id=>document.getElementById(id);
const mic=$("mic"),output=$("output"),start=$("start"),stop=$("stop");
const status=$("status"),transcript=$("transcript"),player=$("player");

let tts=null,voice=null,recognition=null,listening=false,busy=false,stream=null;
let audioCtx=null;

function setStatus(v){status.textContent=v;}

async function loadDevices(){
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    mic.innerHTML="";
    output.innerHTML="";
    devices.filter(d=>d.kind==="audioinput").forEach((d,i)=>{
      const o=document.createElement("option");
      o.value=d.deviceId;o.textContent=d.label||("Microphone "+(i+1));mic.appendChild(o);
    });
    devices.filter(d=>d.kind==="audiooutput").forEach((d,i)=>{
      const o=document.createElement("option");
      o.value=d.deviceId;o.textContent=d.label||("Output "+(i+1));output.appendChild(o);
    });
    if(!mic.options.length)mic.innerHTML="<option value=''>Default microphone</option>";
    if(!output.options.length)output.innerHTML="<option value=''>Default output</option>";
  }catch(e){console.warn(e)}
}

async function setOutput(){
  if(typeof player.setSinkId==="function"&&output.value){
    try{await player.setSinkId(output.value)}catch(e){console.warn(e)}
  }
}

async function loadPocketTTS(){
  if(tts)return;

  setStatus("Loading PocketTTS... first load only.");
  const mod=await import("./pocket-tts/index.js");

  tts=new mod.PocketTTS({
    language:"english_2026-04",
    quantized:true,
    voiceCloning:true,
    cache:true,
    cacheName:"pocket-tts-safe-v2",
    maxThreads:1,
    deferSynthesis:true,
    maxReferenceSeconds:6,
    modelBaseUrl:"https://huggingface.co/akrv/pocket-tts-onnx/resolve/main/onnx",
    ortBaseUrl:"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/"
  });

  await tts.load(p=>{
    if(p.total){
      const pct=Math.round(p.loaded/p.total*100);
      setStatus("Loading PocketTTS: "+pct+"%");
    }
  });

  const refUrl=new URL("./Recording%20(10).wav",location.href);
  const response=await fetch(refUrl);
  if(!response.ok)throw new Error("Recording (10).wav could not be loaded.");

  const bytes=await response.arrayBuffer();
  const decodeCtx=new AudioContext();
  const decoded=await decodeCtx.decodeAudioData(bytes);
  const mono=decoded.getChannelData(0).slice();

  voice=await tts.cloneVoice(mono,{
    inputSampleRate:decoded.sampleRate,
    name:"recording-10"
  });

  await decodeCtx.close();

  setStatus("Loading speech models...");
  await tts.finishLoad();

  audioCtx=new AudioContext();
  await audioCtx.resume().catch(()=>{});
  setStatus("PocketTTS ready - low-memory single-buffer mode.");
}

function makeWavBlob(chunks,sampleRate){
  const total=chunks.reduce((n,c)=>n+c.length,0);
  const pcm=new Float32Array(total);
  let offset=0;
  for(const chunk of chunks){
    pcm.set(chunk,offset);
    offset+=chunk.length;
  }

  const dataSize=pcm.length*2;
  const buffer=new ArrayBuffer(44+dataSize);
  const view=new DataView(buffer);
  const write=(pos,str)=>{
    for(let i=0;i<str.length;i++)view.setUint8(pos+i,str.charCodeAt(i));
  };

  write(0,"RIFF");
  view.setUint32(4,36+dataSize,true);
  write(8,"WAVE");
  write(12,"fmt ");
  view.setUint32(16,16,true);
  view.setUint16(20,1,true);
  view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);
  view.setUint16(34,16,true);
  write(36,"data");
  view.setUint32(40,dataSize,true);

  let pos=44;
  for(const sample of pcm){
    const s=Math.max(-1,Math.min(1,sample));
    view.setInt16(pos,s<0?s*0x8000:s*0x7fff,true);
    pos+=2;
  }
  return new Blob([buffer],{type:"audio/wav"});
}

async function speak(text){
  if(!text||busy||!tts||!voice)return;

  busy=true;

  try{
    if(recognition){try{recognition.stop()}catch{}}

    transcript.textContent="Heard: "+text;
    setStatus("Generating complete audio...");
    await setOutput();

    const chunks=[];
    const metrics=await tts.generate(text,{
      voice,
      onChunk:audio=>{
        if(audio&&audio.length)chunks.push(new Float32Array(audio));
      }
    });

    if(!chunks.length)throw new Error("PocketTTS returned no audio.");

    setStatus("Preparing single audio buffer...");
    const blob=makeWavBlob(chunks,tts.sampleRate);
    const url=URL.createObjectURL(blob);

    const oldUrl=player.dataset.blobUrl;
    if(oldUrl)URL.revokeObjectURL(oldUrl);
    player.dataset.blobUrl=url;
    player.src=url;
    player.load();

    await setOutput();
    await player.play();

    const ms=metrics&&metrics.genTime?Math.round(metrics.genTime*1000):0;
    setStatus(ms?("Playing - generated in ~"+ms+" ms."):"Playing cloned voice...");

    await new Promise(resolve=>{
      const done=()=>{cleanup();resolve()};
      const cleanup=()=>{
        player.removeEventListener("ended",done);
        player.removeEventListener("error",done);
      };
      player.addEventListener("ended",done,{once:true});
      player.addEventListener("error",done,{once:true});
    });

    setStatus("Ready - speak again.");
  }catch(e){
    console.error(e);
    setStatus("PocketTTS error: "+(e.message||e));
  }finally{
    busy=false;
    if(listening)startRecognition();
  }
}

function startRecognition(){
  if(!listening||busy)return;

  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){
    setStatus("Chrome speech recognition is not available.");
    return;
  }

  recognition=new SR();
  recognition.lang="en-US";
  recognition.continuous=true;
  recognition.interimResults=false;
  recognition.maxAlternatives=1;

  recognition.onresult=async e=>{
    const result=e.results[e.results.length-1];
    if(!result.isFinal||busy)return;
    const text=result[0].transcript.trim();
    if(!text)return;
    await speak(text);
  };

  recognition.onerror=e=>{
    if(e.error==="not-allowed"||e.error==="service-not-allowed"){
      setStatus("Allow microphone permission in Chrome, then press START again.");
    }else if(e.error!=="aborted"){
      setStatus("Speech recognition: "+e.error);
    }
  };

  recognition.onend=()=>{
    recognition=null;
    if(listening&&!busy)setTimeout(startRecognition,150);
  };

  try{recognition.start()}catch(e){}
}

async function startListening(){
  if(listening)return;

  try{
    start.disabled=true;
    setStatus("Requesting microphone...");

    stream=await navigator.mediaDevices.getUserMedia({
      audio:{
        deviceId:mic.value?{exact:mic.value}:undefined,
        channelCount:1,
        echoCancellation:true,
        noiseSuppression:true,
        autoGainControl:true
      }
    });

    await loadDevices();
    await loadPocketTTS();

    listening=true;
    stop.disabled=false;
    setStatus("Listening - speak naturally.");
    startRecognition();
  }catch(e){
    console.error(e);
    listening=false;
    stop.disabled=true;
    start.disabled=false;
    setStatus(e.name==="NotAllowedError"
      ?"Microphone permission was blocked. Allow microphone access, then START again."
      :"Start error: "+(e.message||e));
  }
}

function stopListening(){
  listening=false;

  if(recognition){
    try{recognition.stop()}catch{}
    recognition=null;
  }

  if(stream){
    stream.getTracks().forEach(t=>t.stop());
    stream=null;
  }

  player.pause();
  player.currentTime=0;

  start.disabled=false;
  stop.disabled=true;
  setStatus("Stopped.");
}

start.onclick=startListening;
stop.onclick=stopListening;
output.onchange=setOutput;
navigator.mediaDevices.addEventListener?.("devicechange",loadDevices);

(async()=>{await loadDevices()})();