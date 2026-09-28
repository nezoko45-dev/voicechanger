const $=id=>document.getElementById(id);
const mic=$("mic"),output=$("output"),start=$("start"),stop=$("stop");
const status=$("status"),transcript=$("transcript"),player=$("player");
const elevenKeyInput=$("elevenKey");

let tts=null,voice=null,listening=false,busy=false,stream=null;
let audioCtx=null,eleven=null,micSource=null,micProcessor=null,micGain=null;
let elevenReady=false,speechQueue=[],processingQueue=false;
let lastQueuedText="",lastQueuedAt=0,lastSpokenText="",lastSpokenAt=0;
let reconnectTimer=null,reconnectAttempts=0,utteranceParts=[];
let recovering=false;

function setStatus(v){status.textContent=v;}

function getElevenKey(){
  return (elevenKeyInput?.value||"").trim();
}

async function getRealtimeToken(){
  const key=getElevenKey();
  if(!key)throw new Error("Enter your ElevenLabs API key first.");
  const response=await fetch("/scribe-token",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({apiKey:key})});
  if(!response.ok){let detail="";try{const data=await response.json();detail=data.error||data.detail||"";}catch{}throw new Error("Local Scribe token server failed ("+response.status+"). "+detail);}
  const data=await response.json();
  if(!data.token)throw new Error("Token server did not return a Scribe token.");
  return data.token;
}

async function loadDevices(){
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const oldMic=mic.value,oldOutput=output.value;
    mic.innerHTML="";output.innerHTML="";
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
  const dataSize=total*2,buffer=new ArrayBuffer(44+dataSize),view=new DataView(buffer);
  const write=(pos,str)=>{for(let i=0;i<str.length;i++)view.setUint8(pos+i,str.charCodeAt(i));};
  write(0,"RIFF");view.setUint32(4,36+dataSize,true);write(8,"WAVE");
  write(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);
  view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);
  view.setUint16(34,16,true);write(36,"data");view.setUint32(40,dataSize,true);
  let pos=44;
  for(const chunk of chunks)for(const sample of chunk){
    const s=Math.max(-1,Math.min(1,sample));
    view.setInt16(pos,s<0?s*0x8000:s*0x7fff,true);pos+=2;
  }
  return new Blob([buffer],{type:"audio/wav"});
}

async function speak(text){
  if(!text||!tts||!voice)return;
  busy=true;
  try{
    transcript.textContent="Heard: "+text;
    lastSpokenText=normalizeSpeech(text);lastSpokenAt=Date.now();
    setStatus("Generating cloned voice...");
    await setOutput();

    const chunks=[];
    const metrics=await tts.generate(text,{voice,onChunk:audio=>{
      if(audio&&audio.length)chunks.push(new Float32Array(audio));
    }});
    if(!chunks.length)throw new Error("PocketTTS returned no audio.");

    const blob=makeWavBlob(chunks,tts.sampleRate);
    const url=URL.createObjectURL(blob),oldUrl=player.dataset.blobUrl;
    if(oldUrl)URL.revokeObjectURL(oldUrl);
    player.dataset.blobUrl=url;player.src=url;player.load();
    await setOutput();await player.play();

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
    console.error(e);setStatus("PocketTTS error: "+(e.message||e));
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
  speechQueue.push(clean);processSpeechQueue();
}

async function processSpeechQueue(){
  if(processingQueue||!listening||!tts||!voice)return;
  processingQueue=true;
  try{
    while(listening&&speechQueue.length)await speak(speechQueue.shift());
  }finally{
    processingQueue=false;
    if(listening&&speechQueue.length)processSpeechQueue();
  }
}

function downsampleFloat32(input,inputRate,outputRate){
  if(inputRate===outputRate)return new Float32Array(input);
  const ratio=inputRate/outputRate,outLength=Math.max(1,Math.round(input.length/ratio));
  const output=new Float32Array(outLength);let offset=0;
  for(let i=0;i<outLength;i++){
    const next=Math.min(input.length,Math.round((i+1)*ratio));
    let sum=0,count=0;
    for(let j=offset;j<next;j++){sum+=input[j];count++;}
    output[i]=count?sum/count:0;offset=next;
  }
  return output;
}

function floatTo16Bit(input){
  const out=new ArrayBuffer(input.length*2),view=new DataView(out);
  for(let i=0;i<input.length;i++){
    const s=Math.max(-1,Math.min(1,input[i]));
    view.setInt16(i*2,s<0?s*0x8000:s*0x7fff,true);
  }
  return new Uint8Array(out);
}

function bytesToBase64(bytes){
  let binary="";
  const step=0x8000;
  for(let i=0;i<bytes.length;i+=step){
    binary+=String.fromCharCode(...bytes.subarray(i,i+step));
  }
  return btoa(binary);
}

function scheduleReconnect(delay=500){
  if(!listening||reconnectTimer)return;
  reconnectTimer=setTimeout(()=>{
    reconnectTimer=null;
    if(listening)connectEleven();
  },delay);
}

function closeEleven(){
  if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
  if(eleven){try{eleven.close();}catch{}eleven=null;}
  elevenReady=false;
}

async function connectEleven(){
  if(!listening)return;
  try{
    setStatus("Getting ElevenLabs realtime token...");
    const token=await getRealtimeToken();
    if(!listening)return;

    const params=new URLSearchParams({
      model_id:"scribe_v2_realtime",
      token,
      audio_format:"pcm_16000",
      sample_rate:"16000",
      language_code:"en",
      commit_strategy:"vad",
      vad_silence_threshold_secs:"0.3",
      vad_threshold:"0.4",
      min_speech_duration_ms:"80",
      min_silence_duration_ms:"100"
    });

    const ws=new WebSocket(
      "wss://api.elevenlabs.io/v1/speech-to-text/realtime?"+params.toString()
    );
    eleven=ws;

    ws.onopen=()=>{
      if(eleven!==ws)return;
      reconnectAttempts=0;
      setStatus("ElevenLabs Scribe connected.");
    };

    ws.onmessage=event=>{
      if(typeof event.data!=="string")return;
      let msg;try{msg=JSON.parse(event.data);}catch{return;}

      if(msg.message_type==="session_started"){
        elevenReady=true;utteranceParts=[];
        setStatus("Listening - ElevenLabs Scribe + PocketTTS.");
        return;
      }

      if(msg.message_type==="partial_transcript"){
        const text=String(msg.text||"").trim();
        if(text)transcript.textContent="Listening: "+[...utteranceParts,text].join(" ");
        return;
      }

      if(msg.message_type==="committed_transcript"){
        const text=String(msg.text||"").trim();
        if(!text)return;
        utteranceParts.push(text);
        transcript.textContent="Heard: "+utteranceParts.join(" ");
        const utterance=utteranceParts.join(" ").trim();
        utteranceParts=[];
        if(utterance)enqueueSpeech(utterance);
        return;
      }

      if(msg.message_type==="error"||msg.message_type==="rate_limited"){
        console.error("ElevenLabs:",msg);
        setStatus("ElevenLabs error: "+(msg.error||msg.message||"request failed"));
      }
    };

    ws.onerror=()=>{if(eleven===ws)setStatus("ElevenLabs WebSocket error - check the key/token server.");};
    ws.onclose=(event)=>{
      if(eleven!==ws)return;
      console.warn("ElevenLabs WebSocket closed:",event.code,event.reason);
      elevenReady=false;eleven=null;
      if(listening){
        reconnectAttempts++;
        const reason=event.reason?(" "+event.reason):"";
        setStatus("Scribe disconnected ("+event.code+"). Reconnecting..."+reason);
        scheduleReconnect(Math.min(5000,500*Math.max(1,reconnectAttempts)));
      }
    };
  }catch(e){
    console.error(e);
    setStatus(e.message||"ElevenLabs connection failed.");
    if(listening)scheduleReconnect(1500);
  }
}

function startMicStreaming(){
  if(!stream||!audioCtx)return;
  try{
    if(micSource)micSource.disconnect();
    if(micProcessor)micProcessor.disconnect();
    if(micGain)micGain.disconnect();

    micSource=audioCtx.createMediaStreamSource(stream);
    micProcessor=audioCtx.createScriptProcessor(4096,1,1);
    micGain=audioCtx.createGain();micGain.gain.value=0;

    micProcessor.onaudioprocess=e=>{
      if(!elevenReady||!eleven||eleven.readyState!==WebSocket.OPEN)return;
      const pcm=downsampleFloat32(e.inputBuffer.getChannelData(0),audioCtx.sampleRate,16000);
      if(!pcm.length)return;
      eleven.send(JSON.stringify({
        message_type:"input_audio_chunk",
        audio_base_64:bytesToBase64(floatTo16Bit(pcm))
      }));
    };

    micSource.connect(micProcessor);
    micProcessor.connect(micGain);
    micGain.connect(audioCtx.destination);
  }catch(e){
    console.error(e);throw new Error("Could not start microphone streaming: "+(e.message||e));
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
    if(!elevenReady)connectEleven();
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
    if(!getElevenKey())throw new Error("Enter your ElevenLabs API key first.");

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

    listening=true;stop.disabled=false;speechQueue=[];utteranceParts=[];
    startMicStreaming();
    await connectEleven();
  }catch(e){
    console.error(e);listening=false;stop.disabled=true;start.disabled=false;
    stopMicStreaming();closeEleven();
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
    setStatus(e.message||e);
  }
}

function stopListening(){
  listening=false;speechQueue=[];processingQueue=false;utteranceParts=[];
  stopMicStreaming();closeEleven();
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  player.pause();player.currentTime=0;
  start.disabled=false;stop.disabled=true;setStatus("Stopped.");
}

start.onclick=startListening;
stop.onclick=stopListening;
output.onchange=setOutput;
navigator.mediaDevices.addEventListener?.("devicechange",loadDevices);
(async()=>{await loadDevices();})();