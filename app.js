const $=id=>document.getElementById(id);
const mic=$("mic"),output=$("output"),start=$("start"),stop=$("stop"),status=$("status"),transcript=$("transcript");
let tts=null,voice=null,listening=false,processingQueue=false,recognition=null,speechQueue=[];
let lastQueuedText="",lastQueuedAt=0;
function setStatus(v){status.textContent=v;}
async function loadDevices(){
 try{
  const ds=await navigator.mediaDevices.enumerateDevices(),om=mic.value,oo=output.value;mic.innerHTML="";output.innerHTML="";
  ds.filter(d=>d.kind==="audioinput").forEach((d,i)=>{const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||("Microphone "+(i+1));mic.appendChild(o);});
  ds.filter(d=>d.kind==="audiooutput").forEach((d,i)=>{const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||("Output "+(i+1));output.appendChild(o);});
  if(!mic.options.length)mic.innerHTML="<option value=''>Default microphone</option>";
  if(!output.options.length)output.innerHTML="<option value=''>Windows default output</option>";
  if(om&&[...mic.options].some(o=>o.value===om))mic.value=om;if(oo&&[...output.options].some(o=>o.value===oo))output.value=oo;
 }catch(e){console.warn(e);}
}
async function loadPocketTTS(){
 if(tts)return;setStatus("Loading PocketTTS... first load only.");
 const mod=await import("./pocket-tts/index.js");
 tts=new mod.PocketTTS({language:"english_2026-04",quantized:true,voiceCloning:true,cache:true,cacheName:"pocket-tts-safe-v2",maxThreads:2,deferSynthesis:true,maxReferenceSeconds:6,modelBaseUrl:"https://huggingface.co/akrv/pocket-tts-onnx/resolve/main/onnx",ortBaseUrl:"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/"});
 await tts.load(p=>{if(p.total)setStatus("Loading PocketTTS: "+Math.round(p.loaded/p.total*100)+"%");});
 const r=await fetch("./Recording%20(10).wav");if(!r.ok)throw new Error("Recording (10).wav could not be loaded.");
 const ctx=new AudioContext(),decoded=await ctx.decodeAudioData(await r.arrayBuffer());
 voice=await tts.cloneVoice(decoded.getChannelData(0).slice(),{inputSampleRate:decoded.sampleRate,name:"recording-10"});
 await ctx.close();await tts.finishLoad();setStatus("PocketTTS ready.");
}
function makeWav(chunks,rate){
 const total=chunks.reduce((n,c)=>n+c.length,0),dataSize=total*2,buf=new ArrayBuffer(44+dataSize),v=new DataView(buf);
 const w=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};w(0,"RIFF");v.setUint32(4,36+dataSize,true);w(8,"WAVE");w(12,"fmt ");v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,"data");v.setUint32(40,dataSize,true);
 let p=44;for(const c of chunks)for(const x of c){const s=Math.max(-1,Math.min(1,x));v.setInt16(p,s<0?s*32768:s*32767,true);p+=2;}return new Blob([buf],{type:"audio/wav"});
}
function b64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(",")[1]);r.onerror=reject;r.readAsDataURL(blob);});}
async function startChromeStream(rate){
 const ctx=new AudioContext();
 if(typeof ctx.setSinkId==="function"&&output.value){try{await ctx.setSinkId(output.value);}catch(e){console.warn("Chrome output:",e);}}
 if(ctx.state==="suspended")await ctx.resume();
 let cursor=ctx.currentTime+0.02;
 let closed=false;
 const push=chunk=>{
  if(closed||!chunk?.length)return;
  const data=chunk instanceof Float32Array?chunk:new Float32Array(chunk);
  const buffer=ctx.createBuffer(1,data.length,rate);
  buffer.copyToChannel(data,0);
  const source=ctx.createBufferSource();
  source.buffer=buffer;source.connect(ctx.destination);
  cursor=Math.max(cursor,ctx.currentTime+0.01);
  source.start(cursor);
  cursor+=buffer.duration;
 };
 const finish=async()=>{
  if(closed)return;
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,(cursor-ctx.currentTime)*1000)));
  closed=true;
  await ctx.close();
 };
 const cancel=async()=>{
  if(closed)return;
  closed=true;
  try{await ctx.close();}catch{}
 };
 return {push,finish,cancel};
}

let sessionRefreshTimer=null;
function startSessionRefresh(){
  clearInterval(sessionRefreshTimer);
  sessionRefreshTimer=setInterval(()=>{
    if(!listening)return;
    // Touch the page state without reloading it, stopping recognition, or
    // clearing PocketTTS. This prevents the long-running session from going stale.
    try{
      document.title="PocketTTS • "+new Date().toLocaleTimeString();
      void navigator.mediaDevices.enumerateDevices();
    }catch{}
  },4000);
}
function stopSessionRefresh(){
  clearInterval(sessionRefreshTimer);
  sessionRefreshTimer=null;
}

function enqueue(text){
 const clean=String(text||"").replace(/\s+/g," ").trim();if(!clean)return;const n=clean.toLowerCase(),now=Date.now();
 if(n===lastQueuedText&&now-lastQueuedAt<1200)return;lastQueuedText=n;lastQueuedAt=now;speechQueue.push(clean);processQueue();
}
async function processQueue(){
 if(processingQueue||!listening||!tts||!voice)return;processingQueue=true;
 try{while(listening&&speechQueue.length){const text=speechQueue.shift();transcript.textContent="Heard: "+text;setStatus("Generating PocketTTS...");
  const stream=await startChromeStream(tts.sampleRate);
  let heardAudio=false;
  try{
   setStatus("Generating PocketTTS — playing audio immediately...");
   await tts.generate(text,{voice,onChunk:a=>{
    if(!a?.length)return;
    stream.push(a);
    if(!heardAudio){
     heardAudio=true;
     setStatus("Playing TTS through Chrome...");
    }
   }});
   if(!heardAudio)throw new Error("PocketTTS returned no audio.");
   await stream.finish();
  }catch(e){
   await stream.cancel();
   throw e;
  }
  setStatus("Listening...");
 }}catch(e){console.error(e);setStatus("PocketTTS/Chrome error: "+(e.message||e));}finally{processingQueue=false;if(listening&&speechQueue.length)processQueue();}
}
function setupRecognition(){
 const C=window.SpeechRecognition||window.webkitSpeechRecognition;if(!C)throw new Error("Chrome Speech Recognition is required for this TTS version.");
 recognition=new C();recognition.lang="en-US";recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=1;
 recognition.onstart=()=>setStatus("Listening...");
 recognition.onresult=e=>{let interim="";for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript.trim();if(e.results[i].isFinal)enqueue(t);else interim+=t+" ";}if(interim.trim())transcript.textContent="Listening: "+interim.trim();};
 recognition.onerror=e=>{if(e.error!=="aborted"&&listening)setStatus("Speech recognition: "+e.error);};
 recognition.onend=()=>{if(listening)try{recognition.start();}catch{}};
}
async function startListening(){
 if(listening)return;try{start.disabled=true;setStatus("Requesting microphone...");
  await navigator.mediaDevices.getUserMedia({audio:{deviceId:mic.value?{exact:mic.value}:undefined,channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  await loadDevices();await loadPocketTTS();setupRecognition();listening=true;stop.disabled=false;speechQueue=[];recognition.start();
 }catch(e){console.error(e);listening=false;stop.disabled=true;start.disabled=false;setStatus(e.message||String(e));}
}
function stopListening(){stopSessionRefresh();listening=false;speechQueue=[];if(recognition){try{recognition.onend=null;recognition.stop();}catch{}recognition=null;}start.disabled=false;stop.disabled=true;setStatus("Stopped.");}
start.onclick=startListening;stop.onclick=stopListening;navigator.mediaDevices.addEventListener?.("devicechange",loadDevices);loadDevices();