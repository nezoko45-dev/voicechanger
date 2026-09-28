const $=id=>document.getElementById(id);
const mic=$("mic"),output=$("output"),start=$("start"),stop=$("stop");
const status=$("status"),transcript=$("transcript"),player=$("player");

let tts=null,voice=null,recognition=null,listening=false,busy=false,stream=null;

function setStatus(v){status.textContent=v;}

async function loadDevices(){
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    mic.innerHTML="";
    output.innerHTML="";
    devices.filter(d=>d.kind==="audioinput").forEach((d,i)=>{
      const o=document.createElement("option");
      o.value=d.deviceId;o.textContent=d.label||`Microphone ${i+1}`;mic.appendChild(o);
    });
    devices.filter(d=>d.kind==="audiooutput").forEach((d,i)=>{
      const o=document.createElement("option");
      o.value=d.deviceId;o.textContent=d.label||`Output ${i+1}`;output.appendChild(o);
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
  setStatus("Loading browser PocketTTS model… first load can take a while.");
  // Direct browser module; no Node server is needed for GitHub Pages.
  const mod=await import("https://cdn.jsdelivr.net/gh/vlapky/pocket-tts-js@main/src/index.js");
  tts=new mod.PocketTTS({
    language:"english_2026-04",
    quantized:true,
    voiceCloning:true,
    cache:true,
    modelBaseUrl:"https://huggingface.co/akrv/pocket-tts-onnx/resolve/main/onnx",
    ortBaseUrl:"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/"
  });
  await tts.load(p=>{
    if(p.total){
      const pct=Math.round(p.loaded/p.total*100);
      setStatus(`Loading PocketTTS: ${pct}% — ${p.label||"model"}`);
    }
  });

  const refUrl=new URL("./Recording%20(10).wav",location.href);
  const response=await fetch(refUrl);
  if(!response.ok)throw new Error("Recording (10).wav could not be loaded from GitHub Pages.");
  const bytes=await response.arrayBuffer();
  const audioCtx=new AudioContext();
  const decoded=await audioCtx.decodeAudioData(bytes);
  const mono=decoded.getChannelData(0).slice();
  voice=await tts.cloneVoice(mono,{inputSampleRate:decoded.sampleRate,name:"recording-10"});
  await audioCtx.close();
  setStatus("PocketTTS ready.");
}

async function speak(text){
  if(!text||busy)return;
  busy=true;
  try{
    if(recognition){try{recognition.stop()}catch{}}
    setStatus("PocketTTS is echoing you…");
    await setOutput();
    const chunks=[];
    const ctx=new AudioContext({latencyHint:"interactive"});
    await ctx.resume();
    const playerState={next:ctx.currentTime+0.05,nodes:[]};

    await tts.generate(text,{
      voice,
      onChunk:(audio)=>{
        chunks.push(audio);
        const buf=ctx.createBuffer(1,audio.length,tts.sampleRate);
        buf.copyToChannel(audio,0);
        const src=ctx.createBufferSource();
        src.buffer=buf;
        src.connect(ctx.destination);
        const when=Math.max(playerState.next,ctx.currentTime+0.01);
        src.start(when);
        playerState.next=when+buf.duration;
        playerState.nodes.push(src);
      }
    });

    // Also provide a normal audio player for the most recent echo.
    const total=chunks.reduce((n,c)=>n+c.length,0);
    const all=new Float32Array(total);let p=0;
    for(const c of chunks){all.set(c,p);p+=c.length}
    player.src=makeWavUrl(all,tts.sampleRate);
    await new Promise(r=>setTimeout(r,Math.max(100,(playerState.next-ctx.currentTime)*1000)));
    await ctx.close();
    setStatus("Echo complete — say another sentence.");
  }catch(e){
    console.error(e);
    setStatus("PocketTTS error: "+e.message);
  }finally{
    busy=false;
    if(listening)startRecognition();
  }
}

function makeWavUrl(samples,rate){
  const data=new DataView(new ArrayBuffer(44+samples.length*2));
  data.setUint8(0,82);data.setUint8(1,73);data.setUint8(2,70);data.setUint8(3,70);
  data.setUint32(4,36+samples.length*2,true);
  data.setUint8(8,87);data.setUint8(9,65);data.setUint8(10,86);data.setUint8(11,69);
  data.setUint8(12,102);data.setUint8(13,109);data.setUint8(14,116);data.setUint8(15,32);
  data.setUint32(16,16,true);data.setUint16(20,1,true);data.setUint16(22,1,true);
  data.setUint32(24,rate,true);data.setUint32(28,rate*2,true);
  data.setUint16(32,2,true);data.setUint16(34,16,true);
  data.setUint8(36,100);data.setUint8(37,97);data.setUint8(38,116);data.setUint8(39,97);
  data.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){
    const v=Math.max(-1,Math.min(1,samples[i]));
    data.setInt16(44+i*2,v<0?v*32768:v*32767,true);
  }
  return URL.createObjectURL(new Blob([data.buffer],{type:"audio/wav"}));
}

function startRecognition(){
  if(!listening||busy)return;
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){
    setStatus("Chrome speech recognition is not available in this browser.");
    return;
  }
  recognition=new SR();
  recognition.lang="en-US";
  recognition.continuous=true;
  recognition.interimResults=false;
  recognition.maxAlternatives=1;
  recognition.onresult=async e=>{
    const result=e.results[e.results.length-1];
    if(!result.isFinal)return;
    const text=result[0].transcript.trim();
    if(!text)return;
    transcript.textContent="Heard: "+text;
    await speak(text);
  };
  recognition.onerror=e=>{
    if(e.error==="not-allowed"||e.error==="service-not-allowed"){
      setStatus("Microphone/speech permission was blocked. Allow microphone access for this GitHub Pages site, then press START again.");
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
    setStatus("Requesting microphone permission…");
    // Permission is requested from the button click, which avoids the old
    // automatic "NotAllowedError" on page load.
    stream=await navigator.mediaDevices.getUserMedia({
      audio:{deviceId:mic.value?{exact:mic.value}:undefined,channelCount:1,
      echoCancellation:true,noiseSuppression:true,autoGainControl:true}
    });
    await loadDevices();
    await loadPocketTTS();
    listening=true;
    stop.disabled=false;
    setStatus("Listening… say a sentence.");
    startRecognition();
  }catch(e){
    console.error(e);
    listening=false;stop.disabled=true;start.disabled=false;
    setStatus(e.name==="NotAllowedError"
      ?"Microphone permission was blocked. Click the lock/site-permissions icon in Chrome, allow Microphone, then press START again."
      :"Start error: "+e.message);
  }
}

function stopListening(){
  listening=false;
  if(recognition){try{recognition.stop()}catch{}recognition=null}
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
  start.disabled=false;stop.disabled=true;
}

start.onclick=startListening;
stop.onclick=()=>{stopListening();setStatus("Stopped.");};
output.onchange=setOutput;
navigator.mediaDevices.addEventListener?.("devicechange",loadDevices);

(async()=>{await loadDevices()})();