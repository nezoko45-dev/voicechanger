const $=id=>document.getElementById(id);
const mic=$("mic"),apiKey=$("apiKey"),start=$("start"),stop=$("stop"),status=$("status"),transcript=$("transcript");
let tts=null,voice=null,player=null,listening=false,processingQueue=false,deepgram=null,mediaStream=null,audioContext=null,workletNode=null,speechQueue=[];
let lastQueuedText="",lastQueuedAt=0,sessionRefreshTimer=null;

function setStatus(v){status.textContent=v;}

async function loadDevices(){
 try{
  const ds=await navigator.mediaDevices.enumerateDevices(),om=mic.value;mic.innerHTML="";
  ds.filter(d=>d.kind==="audioinput").forEach((d,i)=>{const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||("Microphone "+(i+1));mic.appendChild(o);});
  if(!mic.options.length)mic.innerHTML="<option value=''>Default microphone</option>";
  if(om&&[...mic.options].some(o=>o.value===om))mic.value=om;
 }catch(e){console.warn(e);}
}

async function loadPocketTTS(){
 if(tts)return;
 setStatus("Loading PocketTTS... first load only.");
 const mod=await import("./pocket-tts/index.js");
 tts=new mod.PocketTTS({language:"english_2026-04",quantized:true,voiceCloning:true,cache:true,cacheName:"pocket-tts-safe-v2",maxThreads:2,deferSynthesis:true,maxReferenceSeconds:6,modelBaseUrl:"https://huggingface.co/akrv/pocket-tts-onnx/resolve/main/onnx",ortBaseUrl:"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/"});
 await tts.load(p=>{if(p.total)setStatus("Loading PocketTTS: "+Math.round(p.loaded/p.total*100)+"%");});
 const r=await fetch("./Recording%20(10).wav");if(!r.ok)throw new Error("Recording (10).wav could not be loaded.");
 const ctx=new AudioContext(),decoded=await ctx.decodeAudioData(await r.arrayBuffer());
 voice=await tts.cloneVoice(decoded.getChannelData(0).slice(),{inputSampleRate:decoded.sampleRate,name:"recording-10"});
 await ctx.close();await tts.finishLoad();setStatus("PocketTTS ready.");
}

async function startBrowserPlayer(){
 if(!player){const mod=await import("./pocket-tts/index.js");player=new mod.StreamingPlayer({sampleRate:tts.sampleRate});}
 await player.resume();
}

function enqueue(text){
 const clean=String(text||"").replace(/\s+/g," ").trim();if(!clean)return;
 const n=clean.toLowerCase(),now=Date.now();
 if(n===lastQueuedText&&now-lastQueuedAt<1200)return;
 lastQueuedText=n;lastQueuedAt=now;speechQueue.push(clean);processQueue();
}

async function processQueue(){
 if(processingQueue||!listening||!tts||!voice||!player)return;
 processingQueue=true;
 try{while(listening&&speechQueue.length){
  const text=speechQueue.shift();transcript.textContent="Heard: "+text;let heardAudio=false;
  setStatus("Generating PocketTTS — streaming audio...");
  await tts.generate(text,{voice,onChunk:a=>{if(!a?.length)return;player.play(a);if(!heardAudio){heardAudio=true;setStatus("Speaking...");}}});
  if(!heardAudio)throw new Error("PocketTTS returned no audio.");
  player.flush();setStatus("Listening with Deepgram...");
 }}catch(e){console.error(e);setStatus("PocketTTS/Deepgram error: "+(e.message||e));}
 finally{processingQueue=false;if(listening&&speechQueue.length)processQueue();}
}

function workletSource(){
 return `class DeepgramCapture extends AudioWorkletProcessor{
  constructor(){super();this.buf=[];this.size=1600;}
  process(inputs,outputs){
   const input=inputs[0]?.[0];
   const out=outputs[0]?.[0];
   if(out)out.fill(0);
   if(!input)return true;
   for(let i=0;i<input.length;i++)this.buf.push(input[i]);
   while(this.buf.length>=this.size){
    const chunk=this.buf.splice(0,this.size);
    this.port.postMessage(new Float32Array(chunk));
   }
   return true;
  }
 } registerProcessor("deepgram-capture",DeepgramCapture);`;
}

function floatTo16kPCM(input,fromRate){
 const ratio=fromRate/16000,outLen=Math.floor(input.length/ratio),out=new Int16Array(outLen);
 for(let i=0;i<outLen;i++){
  const pos=i*ratio,idx=Math.floor(pos),frac=pos-idx;
  const a=input[idx]||0,b=input[Math.min(idx+1,input.length-1)]||a;
  const s=a+(b-a)*frac;out[i]=s<0?s*32768:s*32767;
 }
 return out;
}

async function connectDeepgram(){
 const key=apiKey.value.trim();
 if(!key)throw new Error("Enter your Deepgram API key or temporary token first.");
 const url="wss://api.deepgram.com/v1/listen?model=nova-3&language=en-US&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&punctuate=true&endpointing=300&utterance_end_ms=1000";
 setStatus("Connecting to Deepgram STT...");
 deepgram=new WebSocket(url,["token",key]);
 await new Promise((resolve,reject)=>{
  let settled=false;
  const fail=e=>{if(!settled){settled=true;reject(new Error("Deepgram connection failed."));}};
  deepgram.onopen=()=>{if(!settled){settled=true;resolve();}};
  deepgram.onerror=fail;
  deepgram.onclose=e=>{if(!settled)fail(e);};
 });
 deepgram.onmessage=e=>{
  try{
   const m=JSON.parse(e.data);
   if(m.type!=="Results")return;
   const alt=m.channel?.alternatives?.[0];if(!alt)return;
   const text=String(alt.transcript||"").trim();
   if(!text)return;
   if(m.is_final&&m.speech_final){transcript.textContent="Heard: "+text;enqueue(text);}
   else transcript.textContent="Listening: "+text;
  }catch(err){console.warn("Deepgram message:",err);}
 };
 deepgram.onclose=()=>{if(listening)setStatus("Deepgram disconnected.");};
}

async function startAudioCapture(){
 mediaStream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:mic.value?{exact:mic.value}:undefined,channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
 audioContext=new AudioContext();
 await audioContext.resume();
 const blob=new Blob([workletSource()],{type:"application/javascript"});
 const workletUrl=URL.createObjectURL(blob);
 try{
  await audioContext.audioWorklet.addModule(workletUrl);
 }finally{URL.revokeObjectURL(workletUrl);}
 const source=audioContext.createMediaStreamSource(mediaStream);
 workletNode=new AudioWorkletNode(audioContext,"deepgram-capture");
 workletNode.port.onmessage=e=>{
  if(!deepgram||deepgram.readyState!==WebSocket.OPEN)return;
  const pcm=floatTo16kPCM(e.data,audioContext.sampleRate);
  if(pcm.byteLength)deepgram.send(pcm.buffer);
 };
 source.connect(workletNode);
 workletNode.connect(audioContext.destination);
}

function startSessionRefresh(){
 clearInterval(sessionRefreshTimer);
 sessionRefreshTimer=setInterval(()=>{
  if(!listening)return;
  try{void navigator.mediaDevices.enumerateDevices();}catch{}
 },4000);
}
function stopSessionRefresh(){clearInterval(sessionRefreshTimer);sessionRefreshTimer=null;}

async function startListening(){
 if(listening)return;
 try{
  start.disabled=true;setStatus("Requesting microphone...");
  await loadDevices();await loadPocketTTS();await startBrowserPlayer();await connectDeepgram();await startAudioCapture();
  listening=true;stop.disabled=false;speechQueue=[];startSessionRefresh();
  setStatus("Listening with Deepgram...");
 }catch(e){
  console.error(e);stopListening();start.disabled=false;setStatus(e.message||String(e));
 }
}

function stopListening(){
 stopSessionRefresh();listening=false;speechQueue=[];
 if(deepgram){try{deepgram.close();}catch{}deepgram=null;}
 if(workletNode){try{workletNode.disconnect();}catch{}workletNode=null;}
 if(mediaStream){mediaStream.getTracks().forEach(t=>t.stop());mediaStream=null;}
 if(audioContext){try{audioContext.close();}catch{}audioContext=null;}if(player)player.stop();
 start.disabled=false;stop.disabled=true;setStatus("Stopped.");
}

start.onclick=startListening;stop.onclick=stopListening;
navigator.mediaDevices.addEventListener?.("devicechange",loadDevices);
loadDevices();