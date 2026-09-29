const $=id=>document.getElementById(id);
const mic=$("mic"),output=$("output"),start=$("start"),stop=$("stop"),status=$("status"),transcript=$("transcript");

let tts=null,voice=null,player=null,recognition=null,mediaStream=null,captureContext=null,captureNode=null;
let listening=false,generating=false,lastText="",restartTimer=null,ttsChunks=0;

function setStatus(v){status.textContent=v;}

async function loadPocketTTS(){
 if(tts)return;
 setStatus("Loading PocketTTS... first load only.");
 const mod=await import("./pocket-tts/index.js");
 tts=new mod.PocketTTS({
  language:"english_2026-04",quantized:true,voiceCloning:true,cache:true,
  cacheName:"pocket-tts-safe-v2",maxThreads:2,deferSynthesis:true,maxReferenceSeconds:6,
  modelBaseUrl:"https://huggingface.co/akrv/pocket-tts-onnx/resolve/main/onnx",
  ortBaseUrl:"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/"
 });
 await tts.load(p=>{if(p.total)setStatus("Loading PocketTTS: "+Math.round(p.loaded/p.total*100)+"%");});
 const r=await fetch("./Recording%20(10).wav");
 if(!r.ok)throw new Error("Recording (10).wav could not be loaded.");
 const ctx=new AudioContext(),decoded=await ctx.decodeAudioData(await r.arrayBuffer());
 voice=await tts.cloneVoice(decoded.getChannelData(0).slice(),{inputSampleRate:decoded.sampleRate,name:"recording-10"});
 await ctx.close();await tts.finishLoad();
}

async function ensurePlayer(){
 if(!player){
  const mod=await import("./pocket-tts/index.js");
  player=new mod.StreamingPlayer({sampleRate:tts.sampleRate});
 }
 await player.resume();
 await setOutputDevice();
}

async function setOutputDevice(){
 if(!player?.audioContext||!output)return;
 const deviceId=output.value;
 if(!deviceId)return;
 if(typeof player.audioContext.setSinkId!=="function"){
  setStatus("Output selection is not supported by this Chrome version; using the default Windows output.");
  return;
 }
 try{
  await player.audioContext.setSinkId(deviceId);
 }catch(e){
  console.warn("Output device selection failed",e);
  setStatus("Could not select that output; using the default Windows output.");
 }
}

function captureWorkletSource(){
 return `class MicCapture extends AudioWorkletProcessor{
  constructor(){super();this.active=true;}
  process(inputs,outputs){
   const input=inputs[0]?.[0],out=outputs[0]?.[0];
   if(out)out.fill(0);
   if(input&&this.active){
    let sum=0;
    for(let i=0;i<input.length;i++)sum+=input[i]*input[i];
    this.port.postMessage({rms:Math.sqrt(sum/input.length)});
   }
   return true;
  }
 }registerProcessor("mic-capture",MicCapture);`;
}

async function startAudioWorklet(){
 mediaStream=await navigator.mediaDevices.getUserMedia({
  audio:{deviceId:mic.value?{exact:mic.value}:undefined,channelCount:1,
   echoCancellation:true,noiseSuppression:true,autoGainControl:true}
 });
 captureContext=new AudioContext({latencyHint:"interactive"});
 await captureContext.resume();
 const url=URL.createObjectURL(new Blob([captureWorkletSource()],{type:"application/javascript"}));
 try{await captureContext.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
 const source=captureContext.createMediaStreamSource(mediaStream);
 captureNode=new AudioWorkletNode(captureContext,"mic-capture");
 captureNode.port.onmessage=()=>{};
 source.connect(captureNode);
 captureNode.connect(captureContext.destination);
}

function setupSpeechRecognition(){
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR)throw new Error("This browser does not provide SpeechRecognition. Chrome is required for the no-Deepgram version.");
 recognition=new SR();
 recognition.continuous=true;
 recognition.interimResults=true;
 recognition.lang="en-US";
 recognition.maxAlternatives=1;

 recognition.onresult=e=>{
  let interim="",finalText="";
  for(let i=e.resultIndex;i<e.results.length;i++){
   const text=String(e.results[i][0].transcript||"").trim();
   if(e.results[i].isFinal)finalText+=" "+text;else interim+=" "+text;
  }
  interim=interim.trim();finalText=finalText.trim();
  if(interim)transcript.textContent="Hearing: "+interim;
  if(finalText){
   transcript.textContent="Heard: "+finalText;
   speak(finalText);
  }
 };
 recognition.onerror=e=>{
  if(e.error==="not-allowed"||e.error==="service-not-allowed"){
   setStatus("Microphone/speech permission was denied.");return;
  }
  if(listening)restartRecognition();
 };
 recognition.onend=()=>{if(listening)restartRecognition();};
 recognition.start();
}

function restartRecognition(){
 clearTimeout(restartTimer);
 restartTimer=setTimeout(()=>{
  if(!listening||!recognition)return;
  try{recognition.start();}catch{}
 },150);
}

async function speak(text){
 const clean=String(text||"").replace(/\s+/g," ").trim();
 if(!clean||clean.toLowerCase()===lastText.toLowerCase())return;
 lastText=clean;
 while(generating&&listening)await new Promise(r=>setTimeout(r,20));
 if(!listening)return;
 generating=true;
 try{
  await ensurePlayer();
  setStatus("PocketTTS speaking...");
  let heard=false;
  await tts.generate(clean,{voice,onChunk:chunk=>{
   if(!chunk?.length)return;
   player.play(chunk);
   heard=true;
  }});
  if(!heard)throw new Error("PocketTTS returned no audio.");
  player.flush();
  if(listening)setStatus("Listening — you can keep speaking.");
 }catch(e){console.error(e);if(listening)setStatus("PocketTTS error: "+(e.message||e));}
 finally{generating=false;}
}

async function loadOutputDevices(){
 if(!output)return;
 try{
  const current=output.value;
  const ds=await navigator.mediaDevices.enumerateDevices();
  output.innerHTML="<option value=\"\">Default Windows output</option>";
  ds.filter(d=>d.kind==="audiooutput").forEach((d,n)=>{
   const o=document.createElement("option");
   o.value=d.deviceId;
   o.textContent=d.label||("Output "+(n+1));
   output.appendChild(o);
  });
  if(current&&[...output.options].some(o=>o.value===current))output.value=current;
 }catch(e){console.warn(e);}
}

async function loadDevices(){
 try{
  const ds=await navigator.mediaDevices.enumerateDevices(),old=mic.value;mic.innerHTML="";
  ds.filter(d=>d.kind==="audioinput").forEach((d,n)=>{
   const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||("Microphone "+(n+1));mic.appendChild(o);
  });
  if(!mic.options.length)mic.innerHTML="<option value=''>Default microphone</option>";
  if(old&&[...mic.options].some(o=>o.value===old))mic.value=old;
 }catch(e){console.warn(e);}
}

async function startListening(){
 if(listening)return;
 try{
  start.disabled=true;setStatus("Loading local voice...");
  await loadDevices();await loadOutputDevices();await loadPocketTTS();await ensurePlayer();await startAudioWorklet();
  listening=true;stop.disabled=false;
  setupSpeechRecognition();
  setStatus("Listening — speak naturally. PocketTTS will continue speaking while you keep talking.");
 }catch(e){
  console.error(e);stopListening();start.disabled=false;setStatus(e.message||String(e));
 }
}

function stopListening(){
 listening=false;clearTimeout(restartTimer);
 if(recognition){try{recognition.onend=null;recognition.stop();}catch{}recognition=null;}
 if(captureNode){try{captureNode.disconnect();}catch{}captureNode=null;}
 if(captureContext){try{captureContext.close();}catch{}captureContext=null;}
 if(mediaStream){mediaStream.getTracks().forEach(t=>t.stop());mediaStream=null;}
 if(player)player.stop();
 generating=false;start.disabled=false;stop.disabled=true;if(test)test.disabled=true;setStatus("Stopped.");
}

start.onclick=startListening;stop.onclick=stopListening;\nconst test=$("test");\nif(test)test.onclick=()=>speak("Hello! This is your local PocketTTS voice.");
navigator.mediaDevices.addEventListener?.("devicechange",()=>{loadDevices();loadOutputDevices();});
if(output)output.addEventListener("change",setOutputDevice);
loadDevices();loadOutputDevices();