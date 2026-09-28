const $=id=>document.getElementById(id);
const mic=$("mic"),output=$("output"),start=$("start"),stop=$("stop");
const status=$("status"),transcript=$("transcript"),player=$("player");

let tts=null,voice=null,recognition=null,listening=false,busy=false,stream=null;
let audioCtx=null;

const speechQueue=[];
let processingQueue=false;
let recognitionRestartTimer=null;
let recognitionRefreshTimer=null;
let recognitionGeneration=0;
let lastQueuedText="";
let lastQueuedAt=0;
let lastSpokenText="";
let lastSpokenAt=0;
let micMonitorSource=null;
let micMonitorGain=null;
let recovering=false;

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
    maxThreads:2,
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
  const dataSize=total*2;
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
  for(const chunk of chunks){
    for(const sample of chunk){
      const s=Math.max(-1,Math.min(1,sample));
      view.setInt16(pos,s<0?s*0x8000:s*0x7fff,true);
      pos+=2;
    }
  }
  return new Blob([buffer],{type:"audio/wav"});
}

async function speak(text){
  if(!text||!tts||!voice)return;

  busy=true;

  try{
    transcript.textContent="Heard: "+text;
    lastSpokenText=normalizeSpeech(text);
    lastSpokenAt=Date.now();
    setStatus("Generating fast single-buffer audio...");
    await setOutput();

    const chunks=[];
    const metrics=await tts.generate(text,{
      voice,
      onChunk:audio=>{
        if(audio&&audio.length)chunks.push(new Float32Array(audio));
      }
    });

    if(!chunks.length)throw new Error("PocketTTS returned no audio.");

    setStatus("Preparing audio buffer...");
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

    setStatus(speechQueue.length
      ? "Queued speech - processing next..."
      : "Ready - speak again.");
  }catch(e){
    console.error(e);
    setStatus("PocketTTS error: "+(e.message||e));
  }finally{
    busy=false;

    if(listening&&!recognition) scheduleRecognitionRestart(100);
  }
}

function normalizeSpeech(text){
  return String(text||"")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g,"'")
    .replace(/[\u201C\u201D]/g,'"')
    .replace(/\s+/g," ")
    .trim();
}

function enqueueSpeech(text){
  const clean=String(text||"").replace(/\s+/g," ").trim();
  if(!clean)return;

  const normalized=normalizeSpeech(clean);
  const now=Date.now();

  if(normalized===lastQueuedText && now-lastQueuedAt<1800)return;
  if(normalized===lastSpokenText && now-lastSpokenAt<5000)return;

  lastQueuedText=normalized;
  lastQueuedAt=now;
  speechQueue.push(clean);
  processSpeechQueue();
}

async function processSpeechQueue(){
  if(processingQueue||!listening||!tts||!voice)return;
  processingQueue=true;

  try{
    while(listening&&speechQueue.length){
      const text=speechQueue.shift();
      await speak(text);
    }
  }finally{
    processingQueue=false;
    if(listening&&speechQueue.length)processSpeechQueue();
  }
}

function scheduleRecognitionRestart(delay=150){
  if(!listening||busy)return;
  if(recognitionRestartTimer)clearTimeout(recognitionRestartTimer);

  const generation=recognitionGeneration;
  recognitionRestartTimer=setTimeout(()=>{
    recognitionRestartTimer=null;
    if(listening&&!busy&&generation===recognitionGeneration&&!recognition){
      startRecognition();
    }
  },delay);
}

function refreshRecognition(){
  // This is a WATCHDOG, not a forced restart.
  // Never abort a healthy recognition session because doing so can cut off
  // the first words of a sentence.
  if(!listening||busy||processingQueue||speechQueue.length)return;
  if(recognition)return;

  startRecognition();
}

function startRecognition(){
  if(!listening||busy||recognition)return;

  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){
    setStatus("Chrome speech recognition is not available.");
    return;
  }

  recognition=new SR();
  recognition.lang="en-US";
  recognition.continuous=true;
  // Keep partial words flowing back from Chrome while the mic stays live.
  // Final results are still the only text sent to PocketTTS, so interim
  // updates never cause duplicate TTS.
  recognition.interimResults=true;
  recognition.maxAlternatives=1;

  const myGeneration=++recognitionGeneration;

  recognition.onresult=e=>{
    let interim="";
    let newestFinal="";

    for(let i=e.resultIndex;i<e.results.length;i++){
      const result=e.results[i];
      const text=result[0].transcript.trim();
      if(!text)continue;

      if(result.isFinal){
        newestFinal=text;
      }else{
        interim+=(interim?" ":"")+text;
      }
    }

    // Show the live transcription immediately instead of waiting for a
    // final recognition result.
    if(interim){
      transcript.textContent="Listening: "+interim;
    }

    if(newestFinal){
      transcript.textContent="Heard: "+newestFinal;
      enqueueSpeech(newestFinal);
    }
  };

  recognition.onerror=e=>{
    if(e.error==="not-allowed"||e.error==="service-not-allowed"){
      setStatus("Allow microphone permission in Chrome, then press START again.");
    }else if(e.error!=="aborted"){
      setStatus("Speech recognition: "+e.error);
    }
  };

  recognition.onend=()=>{
    if(myGeneration!==recognitionGeneration)return;
    recognition=null;
    scheduleRecognitionRestart(150);
  };

  try{
    // Feed Chrome the SAME live MediaStreamTrack selected by the user.
    // This creates a direct mic -> SpeechRecognition pipeline instead of
    // making recognition independently grab the browser default mic.
    const track=stream?.getAudioTracks?.()[0];
    if(track&&track.readyState==="live"){
      recognition.start(track);
    }else{
      recognition.start();
    }
  }catch(e){
    recognition=null;
    scheduleRecognitionRestart(300);
  }
}

function startRecognitionRefresh(){
  if(recognitionRefreshTimer)clearInterval(recognitionRefreshTimer);

  recognitionRefreshTimer=setInterval(()=>{
    // Every 4 seconds, verify that recognition is still alive.
    // A healthy session is NEVER restarted.
    if(listening&&!busy&&!processingQueue&&!speechQueue.length&&player.paused){
      refreshRecognition();
    }
  },4000);
}

function stopRecognitionRefresh(){
  if(recognitionRefreshTimer){
    clearInterval(recognitionRefreshTimer);
    recognitionRefreshTimer=null;
  }
}

async function resumeAudioPipeline(){
  if(!audioCtx)return;
  try{
    if(audioCtx.state!=="running")await audioCtx.resume();
  }catch(e){
    console.warn("AudioContext resume:",e);
  }
}

function reconnectMicMonitor(){
  if(!audioCtx||!stream)return;
  try{
    if(micMonitorSource)micMonitorSource.disconnect();
    if(micMonitorGain)micMonitorGain.disconnect();

    micMonitorSource=audioCtx.createMediaStreamSource(stream);
    micMonitorGain=audioCtx.createGain();
    micMonitorGain.gain.value=0;
    micMonitorSource.connect(micMonitorGain);
    micMonitorGain.connect(audioCtx.destination);
  }catch(e){
    console.warn("Mic monitor setup:",e);
  }
}

async function recoverAfterTabSwitch(){
  if(recovering||!listening)return;
  recovering=true;

  try{
    await resumeAudioPipeline();

    if(stream){
      const dead=stream.getAudioTracks().some(t=>t.readyState==="ended");
      if(dead){
        setStatus("Microphone stopped by Chrome - reconnecting...");
        try{
          stream=await navigator.mediaDevices.getUserMedia({
            audio:{
              deviceId:mic.value?{exact:mic.value}:undefined,
              channelCount:1,
              echoCancellation:true,
              noiseSuppression:true,
              autoGainControl:true
            }
          });
          reconnectMicMonitor();
        }catch(e){
          console.warn("Microphone reconnect:",e);
        }
      }else{
        reconnectMicMonitor();
      }
    }

    if(listening&&!busy){
      recognitionGeneration++;

      if(recognitionRestartTimer){
        clearTimeout(recognitionRestartTimer);
        recognitionRestartTimer=null;
      }

      if(recognition){
        try{recognition.abort()}catch{}
        recognition=null;
      }

      startRecognition();
      setStatus("Listening - background tab recovered.");
    }
  }finally{
    recovering=false;
  }
}

document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"){
    recoverAfterTabSwitch();
  }
});

document.addEventListener("resume",()=>{
  if(document.visibilityState==="visible")recoverAfterTabSwitch();
});

window.addEventListener("pageshow",()=>{
  if(document.visibilityState==="visible")recoverAfterTabSwitch();
});

window.addEventListener("focus",()=>{
  if(document.visibilityState==="visible")recoverAfterTabSwitch();
});

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

    await resumeAudioPipeline();
    reconnectMicMonitor();

    listening=true;
    stop.disabled=false;
    setStatus("Listening - speech recognition watchdog active.");
    startRecognition();
    startRecognitionRefresh();
  }catch(e){
    console.error(e);
    listening=false;
    stopRecognitionRefresh();
    stop.disabled=true;
    start.disabled=false;
    setStatus(e.name==="NotAllowedError"
      ?"Microphone permission was blocked. Allow microphone access, then START again."
      :"Start error: "+(e.message||e));
  }
}

function stopListening(){
  listening=false;
  speechQueue.length=0;
  processingQueue=false;
  recognitionGeneration++;
  stopRecognitionRefresh();

  if(recognitionRestartTimer){
    clearTimeout(recognitionRestartTimer);
    recognitionRestartTimer=null;
  }

  if(recognition){
    try{recognition.stop()}catch{}
    recognition=null;
  }

  if(micMonitorSource){
    try{micMonitorSource.disconnect()}catch{}
    micMonitorSource=null;
  }
  if(micMonitorGain){
    try{micMonitorGain.disconnect()}catch{}
    micMonitorGain=null;
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