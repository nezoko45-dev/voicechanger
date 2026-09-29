const $=id=>document.getElementById(id);
const reference=$("reference"),output=$("output"),chooseOutput=$("chooseOutput"),text=$("text"),start=$("start"),stop=$("stop"),status=$("status"),info=$("info"),meterBar=$("meterBar");
const TTS_URL="./pocket-tts/index.js";

let tts=null,voiceRef=null,ttsPlayer=null,running=false,ttsBusy=false;
let recognition=null,restartTimer=null,recognitionStarted=false;
let spokenWords=0,lastInterim="",pendingText="",speechTimer=null;

function setStatus(v){status.textContent=v;}
function updateStartButton(){start.disabled=!(reference.files?.[0]&&!running);}

async function setOutput(){
 if(ttsPlayer?.setSinkId){
  try{await ttsPlayer.setSinkId(output.value||"");}catch(e){console.warn(e);}
 }
}
async function loadOutputs(){
 if(!navigator.mediaDevices?.enumerateDevices)return;
 try{
  const devices=await navigator.mediaDevices.enumerateDevices(),old=output.value;
  output.innerHTML="<option value=''>Default Chrome output</option>";
  devices.filter(d=>d.kind==="audiooutput").forEach(d=>{
   const o=document.createElement("option");
   o.value=d.deviceId;o.textContent=d.label||"Speaker / output "+output.options.length;
   output.appendChild(o);
  });
  if([...output.options].some(o=>o.value===old))output.value=old;
 }catch(e){console.warn(e);}
}

async function chooseChromeSpeaker(){
 if(!navigator.mediaDevices?.selectAudioOutput){
  setStatus("Chrome speaker picker unavailable; using the default output.");return;
 }
 try{
  const d=await navigator.mediaDevices.selectAudioOutput();
  if(d?.deviceId){
   output.innerHTML="";
   const o=document.createElement("option");
   o.value=d.deviceId;o.textContent=d.label||"Selected Chrome speaker";
   output.appendChild(o);
   await setOutput();setStatus("Speaker selected.");
  }
 }catch(e){if(e.name!=="NotAllowedError")setStatus("Speaker picker error: "+e.message);}
}

async function initTTS(){
 if(tts)return;
 const mod=await import(TTS_URL);
 tts=new mod.PocketTTS({
  language:"english_2026-04",
  quantized:true,
  voiceCloning:true,
  cache:true,
  cacheName:"pocket-tts-wav-only-v4",
  maxThreads:8,
  maxReferenceSeconds:6
 });
 ttsPlayer=new mod.StreamingPlayer({sampleRate:tts.sampleRate,primeSeconds:.04});
 await ttsPlayer.resume();
 setStatus("Loading PocketTTS models…");
 await tts.load(p=>{
  if(p?.label){
   const pct=p.total?Math.round(p.loaded/p.total*100):"";
   setStatus("PocketTTS: "+p.label+(pct!==""?" "+pct+"%":""));
   if(p.total)meterBar.style.width=Math.min(100,Math.round(p.loaded/p.total*100))+"%";
  }
 });
 await setOutput();
}

async function prepareVoice(){
 const file=reference.files?.[0];
 if(!file)throw new Error("Choose your WAV voice reference first.");
 const buf=await file.arrayBuffer(),ac=new AudioContext();
 try{
  const decoded=await ac.decodeAudioData(buf);
  if(decoded.numberOfChannels<1)throw new Error("The WAV has no audio channel.");
  if(decoded.duration<1)throw new Error("The WAV is too short. Use the working WAV reference.");
  const mono=decoded.getChannelData(0).slice();
  setStatus("Preparing YOUR WAV voice…");
  voiceRef=await tts.cloneVoice(mono,{inputSampleRate:decoded.sampleRate,name:"github-pages-wav-voice"});
 }finally{await ac.close();}
 await tts.finishLoad?.();
 info.textContent="WAV voice loaded. No preset voice is selected.";
}

function normalize(s){return s.replace(/\s+/g," ").trim();}
function words(s){return normalize(s).split(" ").filter(Boolean);}
function commonPrefixWords(a,b){
 const A=words(a),B=words(b),n=Math.min(A.length,B.length);let i=0;
 while(i<n&&A[i].toLowerCase()===B[i].toLowerCase())i++;
 return i;
}

/*
  Low-latency commit:
  - Chrome gives interim text continuously.
  - We keep the last 2 words uncommitted so the recognizer can revise them.
  - Once 3+ stable words exist, they are sent to PocketTTS.
  - This prevents waiting for an entire sentence while also avoiding repeated
    words from every interim recognition event.
*/
function handleInterim(raw){
 const current=normalize(raw);
 if(!current)return;
 text.value=current;
 lastInterim=current;

 const W=words(current);
 const safeCount=Math.max(0,W.length-2);
 const safe=W.slice(0,safeCount).join(" ");
 if(!safe)return;

 const already=spokenWords;
 if(W.length>already+2){
  const piece=W.slice(already,safeCount).join(" ");
  if(piece)queueSpeech(piece);
  spokenWords=safeCount;
 }
}

function handleFinal(raw){
 const current=normalize(raw);
 if(!current)return;
 text.value=current;
 const W=words(current);
 const remaining=W.slice(Math.min(spokenWords,W.length)).join(" ");
 if(remaining)queueSpeech(remaining);
 spokenWords=W.length;
 lastInterim="";
}

let speechQueue=[],speechWorker=false;
function queueSpeech(s){
 s=normalize(s);
 if(!s)return;
 speechQueue.push(s);
 if(speechQueue.length>2)speechQueue.splice(0,speechQueue.length-2);
 void drainSpeech();
}

async function drainSpeech(){
 if(speechWorker)return;
 speechWorker=true;
 try{
  while(running&&speechQueue.length){
   const phrase=speechQueue.shift();
   setStatus("Speaking: "+phrase);
   await tts.generate(phrase,{voice:voiceRef,onChunk:(audio,meta)=>{
    if(running)ttsPlayer?.play(audio,meta);
   }});
   if(running)ttsPlayer?.flush();
  }
 }catch(e){
  if(running)setStatus("PocketTTS error: "+(e.message||e));
 }finally{
  speechWorker=false;
  if(running&&speechQueue.length)void drainSpeech();
  else if(running)setStatus("Listening — speak now.");
 }
}

function startRecognition(){
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR)throw new Error("Chrome Speech Recognition is unavailable. Use Google Chrome.");

 recognition=new SR();
 recognition.lang="en-US";
 recognition.continuous=true;
 recognition.interimResults=true;
 recognition.maxAlternatives=1;

 recognition.onstart=()=>{
  recognitionStarted=true;
  setStatus("Listening — speak now.");
 };
 recognition.onresult=e=>{
  for(let i=e.resultIndex;i<e.results.length;i++){
   const result=e.results[i],phrase=result[0]?.transcript?.trim();
   if(!phrase)continue;
   if(result.isFinal)handleFinal(phrase);
   else handleInterim(phrase);
  }
 };
 recognition.onerror=e=>{
  console.warn("SpeechRecognition:",e.error);
  if(e.error==="not-allowed"||e.error==="service-not-allowed"){
   setStatus("Chrome microphone/speech permission was denied.");
   running=false;stopRecognition();updateStartButton();stop.disabled=true;return;
  }
  if(running)setStatus("Reconnecting microphone recognition…");
 };
 recognition.onend=()=>{
  recognitionStarted=false;
  if(!running)return;
  clearTimeout(restartTimer);
  restartTimer=setTimeout(()=>{
   if(running){
    try{recognition.start();}catch{}
   }
  },60);
 };
 recognition.start();
}

function stopRecognition(){
 clearTimeout(restartTimer);restartTimer=null;
 try{recognition?.stop();}catch{}
 recognition=null;recognitionStarted=false;
}

async function startAll(){
 if(running)return;
 try{
  if(!reference.files?.[0])throw new Error("Choose your WAV voice reference first.");
  start.disabled=true;running=true;stop.disabled=false;
  text.value="";spokenWords=0;lastInterim="";pendingText="";speechQueue=[];
  setStatus("Loading your WAV voice…");
  await initTTS();
  if(!running)return;
  await prepareVoice();
  if(!running)return;
  await loadOutputs();await setOutput();
  startRecognition();
  setStatus("Listening — speak now.");
 }catch(e){
  console.error(e);
  running=false;stopRecognition();speechQueue=[];
  try{ttsPlayer?.stop?.();}catch{}
  setStatus("Start error: "+(e.message||e));
  stop.disabled=true;updateStartButton();
 }
}

async function stopAll(){
 running=false;stopRecognition();speechQueue=[];spokenWords=0;
 try{await tts?.stop();}catch{}
 try{ttsPlayer?.stop?.();}catch{}
 stop.disabled=true;updateStartButton();
 setStatus("Stopped.");
}

reference.onchange=()=>{updateStartButton();if(reference.files?.[0])setStatus("WAV selected — press START.");};
start.onclick=()=>void startAll();
stop.onclick=()=>void stopAll();
chooseOutput.onclick=chooseChromeSpeaker;
output.onchange=()=>void setOutput();
navigator.mediaDevices?.addEventListener?.("devicechange",loadOutputs);
void loadOutputs();
updateStartButton();
