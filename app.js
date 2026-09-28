const $=id=>document.getElementById(id);
const mic=$("mic"),output=$("output"),start=$("start"),stop=$("stop");
const status=$("status"),transcript=$("transcript"),player=$("player");
const deepgramKeyInput=$("deepgramKey");

let tts=null,voice=null,listening=false,busy=false,stream=null;
let audioCtx=null,deepgram=null,micSource=null,micProcessor=null,micGain=null;
let deepgramReady=false;
let speechQueue=[],processingQueue=false;
let lastQueuedText="",lastQueuedAt=0,lastSpokenText="",lastSpokenAt=0;
let deepgramReconnectTimer=null,keepAliveTimer=null,reconnectAttempts=0;
let utteranceParts=[];
let recovering=false;

function setStatus(v){status.textContent=v;}

function getDeepgramKey(){
  return (deepgramKeyInput?.value||localStorage.getItem("deepgram_api_key")||"").trim();
}

function saveDeepgramKey(){
  const key=(deepgramKeyInput?.value||"").trim();
  if(key)localStorage.setItem("deepgram_api_key",key);
  else localStorage.removeItem("deepgram_api_key");
}

async function loadDevices(){
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const oldMic=mic.value,oldOutput=output.value;
    mic.innerHTML=""; output.innerHTML="";
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
    if(oldMic&&[...mic.options].some(o=>o.value===oldMic))mic.value=oldMic;
    if(oldOutput&&[...output.options].some(o=>o.value===oldOutput))output.value=oldOutput;
  }catch(e){console.warn(e);}
}

async function setOutput(){
  if(typeof player.setSinkId==="function"&&output.value){
    try{await player.setSinkId(output.value);}catch(e){console.warn(e);}
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
    if(p.total)setStatus("Loading PocketTTS: "+Math.round(p.loaded/p.total*100)+"%");
  });

  const response=await fetch(new URL("./Recording%20(10).wav",location.href));
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
  setStatus("PocketTTS ready.");
}

function makeWavBlob(chunks,sampleRate){
  const total=chunks.reduce((n,c)=>n+c.length,0);
  const dataSize=total*2;
  const buffer=new ArrayBuffer(44+dataSize);
  const view=new DataView(buffer);
  const write=(pos,str)=>{for(let i=0;i<str.length;i++)view.setUint8(pos+i,str.charCodeAt(i));};
  write(0,"RIFF");view.setUint32(4,36+dataSize,true);write(8,"WAVE");
  write(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);
  view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);
  view.setUint16(34,16,true);write(36,"data");view.setUint32(40,dataSize,true);
  let pos=44;
  for(const chunk of chunks){
    for(const sample of chunk){
      const s=Math.max(-1,Math.min(1,sample));
      view.setInt16(pos,s<0?s*0x8000:s*0x7fff,true);pos+=2;
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
    setStatus("Generating cloned voice...");
    await setOutput();

    const chunks=[];
    const metrics=await tts.generate(text,{
      voice,
      onChunk:audio=>{if(audio&&audio.length)chunks.push(new Float32Array(audio));}
    });
    if(!chunks.length)throw new Error("PocketTTS returned no audio.");

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
    setStatus(ms?"Playing cloned voice (~"+ms+" ms generation).":"Playing cloned voice...");

    await new Promise(resolve=>{
      const done=()=>{cleanup();resolve();};
      const cleanup=()=>{
        player.removeEventListener("ended",done);
        player.removeEventListener("error",done);
      };
      player.addEventListener("ended",done,{once:true});
      player.addEventListener("error",done,{once:true});
    });
  }catch(e){
    console.error(e);
    setStatus("PocketTTS error: "+(e.message||e));
  }finally{
    busy=false;
    if(listening&&speechQueue.length)processSpeechQueue();
  }
}

function normalizeSpeech(text){
  return String(text||"").toLowerCase()
    .replace(/[\u2018\u2019]/g,"'")
    .replace(/[\u201C\u201D]/g,'"')
    .replace(/\s+/g," ").trim();
}

function enqueueSpeech(text){
  const clean=String(text||"").replace(/\s+/g," ").trim();
  if(!clean)return;
  const normalized=normalizeSpeech(clean),now=Date.now();
  if(normalized===lastQueuedText&&now-lastQueuedAt<1200)return;
  if(normalized===lastSpokenText&&now-lastSpokenAt<3500)return;
  lastQueuedText=normalized;lastQueuedAt=now;
  speechQueue.push(clean);
  processSpeechQueue();
}

async function processSpeechQueue(){
  if(processingQueue||!listening||!tts||!voice)return;
  processingQueue=true;
  try{
    while(listening&&speechQueue.length){
      await speak(speechQueue.shift());
    }
  }finally{
    processingQueue=false;
    if(listening&&speechQueue.length)processSpeechQueue();
  }
}

function downsampleFloat32(input,inputRate,outputRate){
  if(inputRate===outputRate)return new Float32Array(input);
  const ratio=inputRate/outputRate;
  const outLength=Math.max(1,Math.round(input.length/ratio));
  const output=new Float32Array(outLength);
  let offset=0;
  for(let i=0;i<outLength;i++){
    const next=Math.min(input.length,Math.round((i+1)*ratio));
    let sum=0,count=0;
    for(let j=offset;j<next;j++){sum+=input[j];count++;}
    output[i]=count?sum/count:0;
    offset=next;
  }
  return output;
}

function floatTo16BitPCM(input){
  const out=new ArrayBuffer(input.length*2);
  const view=new DataView(out);
  for(let i=0;i<input.length;i++){
    const s=Math.max(-1,Math.min(1,input[i]));
    view.setInt16(i*2,s<0?s*0x8000:s*0x7fff,true);
  }
  return out;
}

function scheduleDeepgramReconnect(delay=500){
  if(!listening||deepgramReconnectTimer)return;
  deepgramReconnectTimer=setTimeout(()=>{
    deepgramReconnectTimer=null;
    if(listening)connectDeepgram();
  },delay);
}

function closeDeepgram(){
  if(deepgramReconnectTimer){clearTimeout(deepgramReconnectTimer);deepgramReconnectTimer=null;}
  if(keepAliveTimer){clearInterval(keepAliveTimer);keepAliveTimer=null;}
  if(deepgram){
    try{deepgram.close();}catch{}
    deepgram=null;
  }
  deepgramReady=false;
}

function connectDeepgram(){
  const key=getDeepgramKey();
  if(!key){
    setStatus("Enter your Deepgram API key, then press START.");
    return;
  }
  closeDeepgram();

  const params=new URLSearchParams({
    model:"nova-3",
    language:"en-US",
    encoding:"linear16",
    sample_rate:"16000",
    channels:"1",
    interim_results:"true",
    endpointing:"300",
    punctuate:"true",
    smart_format:"true",
    vad_events:"true"
  });

  const ws=new WebSocket(
    "wss://api.deepgram.com/v1/listen?"+params.toString(),
    ["token",key]
  );
  deepgram=ws;

  ws.binaryType="arraybuffer";

  ws.onopen=()=>{
    if(deepgram!==ws)return;
    deepgramReady=true;
    reconnectAttempts=0;
    utteranceParts=[];
    setStatus("Listening - Deepgram streaming STT + PocketTTS.");
    if(keepAliveTimer)clearInterval(keepAliveTimer);
    keepAliveTimer=setInterval(()=>{
      if(ws.readyState===WebSocket.OPEN){
        try{ws.send(JSON.stringify({type:"KeepAlive"}));}catch{}
      }
    },8000);
  };

  ws.onmessage=event=>{
    if(typeof event.data!=="string")return;
    let msg;
    try{msg=JSON.parse(event.data);}catch{return;}

    if(msg.type==="Results"){
      const alt=msg.channel?.alternatives?.[0];
      const text=alt?.transcript?.trim()||"";
      if(!text)return;

      if(msg.is_final){
        utteranceParts.push(text);
        transcript.textContent="Heard: "+utteranceParts.join(" ");
      }else{
        transcript.textContent="Listening: "+[...utteranceParts,text].join(" ");
      }

      if(msg.speech_final){
        const utterance=utteranceParts.join(" ").trim();
        utteranceParts=[];
        if(utterance)enqueueSpeech(utterance);
      }
    }else if(msg.type==="SpeechStarted"){
      setStatus("Listening...");
    }else if(msg.type==="UtteranceEnd"){
      const utterance=utteranceParts.join(" ").trim();
      utteranceParts=[];
      if(utterance)enqueueSpeech(utterance);
    }else if(msg.type==="Error"){
      console.error("Deepgram:",msg);
      setStatus("Deepgram error: "+(msg.message||"stream error"));
    }
  };

  ws.onerror=()=>{
    if(deepgram===ws)setStatus("Deepgram connection error - reconnecting...");
  };

  ws.onclose=()=>{
    if(deepgram!==ws)return;
    deepgramReady=false;
    if(keepAliveTimer){clearInterval(keepAliveTimer);keepAliveTimer=null;}
    deepgram=null;
    if(listening){
      reconnectAttempts++;
      scheduleDeepgramReconnect(Math.min(4000,300*Math.max(1,reconnectAttempts)));
    }
  };
}

function startMicStreaming(){
  if(!stream||!audioCtx)return;
  try{
    if(micSource)micSource.disconnect();
    if(micProcessor)micProcessor.disconnect();
    if(micGain)micGain.disconnect();

    micSource=audioCtx.createMediaStreamSource(stream);
    micProcessor=audioCtx.createScriptProcessor(4096,1,1);
    micGain=audioCtx.createGain();
    micGain.gain.value=0;

    micProcessor.onaudioprocess=e=>{
      if(!deepgramReady||!deepgram||deepgram.readyState!==WebSocket.OPEN)return;
      const input=e.inputBuffer.getChannelData(0);
      const pcm16=downsampleFloat32(input,audioCtx.sampleRate,16000);
      if(pcm16.length)deepgram.send(floatTo16BitPCM(pcm16));
    };

    micSource.connect(micProcessor);
    micProcessor.connect(micGain);
    micGain.connect(audioCtx.destination);
  }catch(e){
    console.error(e);
    throw new Error("Could not start microphone streaming: "+(e.message||e));
  }
}

function stopMicStreaming(){
  if(micSource){try{micSource.disconnect();}catch{}micSource=null;}
  if(micProcessor){try{micProcessor.disconnect();}catch{}micProcessor.onaudioprocess=null;micProcessor=null;}
  if(micGain){try{micGain.disconnect();}catch{}micGain=null;}
}

async function resumeAudioPipeline(){
  if(audioCtx&&audioCtx.state!=="running")await audioCtx.resume().catch(()=>{});
}

async function recoverAfterTabSwitch(){
  if(recovering||!listening)return;
  recovering=true;
  try{
    await resumeAudioPipeline();
    if(stream&&stream.getAudioTracks().some(t=>t.readyState==="ended")){
      stream=await navigator.mediaDevices.getUserMedia({
        audio:{
          deviceId:mic.value?{exact:mic.value}:undefined,
          channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true
        }
      });
      startMicStreaming();
    }
    if(!deepgramReady)connectDeepgram();
  }catch(e){console.warn("Recovery:",e);}
  finally{recovering=false;}
}

document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible")recoverAfterTabSwitch();
});
window.addEventListener("focus",()=>{
  if(document.visibilityState==="visible")recoverAfterTabSwitch();
});
window.addEventListener("pageshow",()=>{
  if(document.visibilityState==="visible")recoverAfterTabSwitch();
});

async function startListening(){
  if(listening)return;
  try{
    start.disabled=true;
    saveDeepgramKey();
    if(!getDeepgramKey())throw new Error("Deepgram API key is required.");

    setStatus("Requesting microphone...");
    stream=await navigator.mediaDevices.getUserMedia({
      audio:{
        deviceId:mic.value?{exact:mic.value}:undefined,
        channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true
      }
    });

    await loadDevices();
    await loadPocketTTS();
    await resumeAudioPipeline();

    listening=true;
    stop.disabled=false;
    speechQueue=[];
    utteranceParts=[];

    startMicStreaming();
    connectDeepgram();
  }catch(e){
    console.error(e);
    listening=false;
    stop.disabled=true;
    start.disabled=false;
    stopMicStreaming();
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
    closeDeepgram();
    setStatus(e.message||e);
  }
}

function stopListening(){
  listening=false;
  speechQueue=[];
  processingQueue=false;
  utteranceParts=[];
  stopMicStreaming();
  closeDeepgram();

  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  player.pause();
  player.currentTime=0;
  start.disabled=false;
  stop.disabled=true;
  setStatus("Stopped.");
}

if(deepgramKeyInput){
  deepgramKeyInput.value=localStorage.getItem("deepgram_api_key")||"";
  deepgramKeyInput.addEventListener("change",saveDeepgramKey);
  deepgramKeyInput.addEventListener("blur",saveDeepgramKey);
}
start.onclick=startListening;
stop.onclick=stopListening;
output.onchange=setOutput;
navigator.mediaDevices.addEventListener?.("devicechange",loadDevices);
(async()=>{await loadDevices();})();