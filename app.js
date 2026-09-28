const $=id=>document.getElementById(id);
const mic=$("mic"),output=$("output"),start=$("start"),stop=$("stop");
const status=$("status"),transcript=$("transcript"),player=$("player");

let tts=null,voice=null,recognition=null,listening=false,busy=false,stream=null;
let streamingPlayer=null,audioCtx=null;

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
    maxThreads:8,
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

  const modPlayer=await import("./pocket-tts/player.js");

  audioCtx=new AudioContext({sampleRate:tts.sampleRate});
  streamingPlayer=new modPlayer.StreamingPlayer({
    sampleRate:tts.sampleRate,
    audioContext:audioCtx,
    outputElement:player,
    primeSeconds:0.18,
    minPrimeSeconds:0.18,
    maxPrimeSeconds:0.45,
    leadSeconds:0.015,
    onUnderrun:info=>console.warn("PocketTTS audio underrun",info)
  });

  await streamingPlayer.resume();
  setStatus("PocketTTS ready - fast streaming mode.");
}

async function speak(text){
  if(!text||busy||!tts||!voice)return;

  busy=true;

  try{
    if(recognition){try{recognition.stop()}catch{}}

    transcript.textContent="Heard: "+text;
    setStatus("Generating...");
    await setOutput();

    if(!streamingPlayer)throw new Error("Streaming audio player is not ready.");

    streamingPlayer.reset();
    await streamingPlayer.resume();

    let firstChunk=true;
    let chunkCount=0;

    const metrics=await tts.generate(text,{
      voice,
      onChunk:audio=>{
        if(!audio||!audio.length)return;

        chunkCount++;

        if(firstChunk){
          firstChunk=false;
          setStatus("Playing cloned voice...");
        }

        streamingPlayer.play(audio);
      }
    });

    streamingPlayer.flush();

    if(!chunkCount)throw new Error("PocketTTS returned no audio.");

    const ms=metrics&&metrics.genTime?Math.round(metrics.genTime*1000):0;
    setStatus(ms?("Playing - generated in ~"+ms+" ms."):"Playing cloned voice...");

    await waitForPlayback();
    setStatus("Ready - speak again.");
  }catch(e){
    console.error(e);
    setStatus("PocketTTS error: "+e.message);
  }finally{
    busy=false;
    if(listening)startRecognition();
  }
}

function waitForPlayback(){
  return new Promise(resolve=>{
    if(!streamingPlayer||!streamingPlayer.audioContext){resolve();return;}

    const ctx=streamingPlayer.audioContext;
    const check=()=>{
      if(!streamingPlayer||ctx.state==="closed"){resolve();return;}
      const remaining=streamingPlayer._nextStartTime-ctx.currentTime;
      if(remaining<=0.02)resolve();
      else setTimeout(check,Math.min(30,Math.max(5,remaining*1000)));
    };
    check();
  });
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
    if(listening&&!busy)setTimeout(startRecognition,50);
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
      :"Start error: "+e.message);
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

  if(streamingPlayer)streamingPlayer.stop();

  start.disabled=false;
  stop.disabled=true;
}

start.onclick=startListening;
stop.onclick=()=>{
  stopListening();
  setStatus("Stopped.");
};

output.onchange=setOutput;
navigator.mediaDevices.addEventListener?.("devicechange",loadDevices);

(async()=>{await loadDevices()})();