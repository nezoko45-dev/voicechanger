const $=id=>document.getElementById(id);
const reference=$("reference"),output=$("output"),chooseOutput=$("chooseOutput"),text=$("text"),start=$("start"),stop=$("stop"),status=$("status"),info=$("info"),meterBar=$("meterBar");
const TTS_URL="./pocket-tts/index.js";

let tts=null,voiceRef=null,ttsPlayer=null,running=false;
let recognition=null,restartTimer=null;
let spokenWords=0;

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
 ttsPlayer=new mod.StreamingPlayer({sampleRate:tts.sampleRate,primeSeconds:.01});
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

/*
 Keep-up mode:
 - Do NOT build a long FIFO of old speech.
 - Chrome interim text is treated as a moving window.
 - Only 1-2 newly stable words are submitted at a time.
 - If PocketTTS is still generating, replace the pending phrase with the
   newest phrase instead of making the output fall further behind.
*/
let pendingPhrase="";
let speechWorker=false;
let generationToken=0;

function queueLatest(s){
 s=normalize(s);
 if(!s)return;

 // Never let old speech accumulate. The newest text wins.
 pendingPhrase=pendingPhrase ? normalize(pendingPhrase+" "+s) : s;

 // Keep the pending buffer tiny so it follows the microphone.
 const w=words(pendingPhrase);
 if(w.length>3)pendingPhrase=w.slice(-3).join(" ");

 void drainSpeech();
}

async function drainSpeech(){
 if(speechWorker)return;
 speechWorker=true;
 try{
  while(running && pendingPhrase){
   const phrase=pendingPhrase;
   pendingPhrase="";
   const token=++generationToken;

   setStatus("Speaking: "+phrase);

   await tts.generate(phrase,{
    voice:voiceRef,
    onChunk:(audio,meta)=>{
     // If newer speech arrived while this phrase was generating, don't
     // add late audio from the stale phrase to the playback queue.
     if(running && token===generationToken) ttsPlayer?.play(audio,meta);
    }
   });

   // Only flush audio that belongs to the newest generation.
   if(running && token===generationToken) ttsPlayer?.flush();
  }
 }catch(e){
  if(running)setStatus("PocketTTS error: "+(e.message||e));
 }finally{
  speechWorker=false;
  if(running && pendingPhrase)void drainSpeech();
  else if(running)setStatus("Listening — speak now.");
 }
}

function commitInterim(raw){
 const current=normalize(raw);
 if(!current)return;
 text.value=current;

 const W=words(current);
 // Commit only the oldest stable word(s), leaving the newest 2 words
 // available for Chrome to revise.
 const safeCount=Math.max(0,W.length-2);
 if(safeCount<=spokenWords)return;

 const piece=W.slice(spokenWords,safeCount).join(" ");
 if(piece)queueLatest(piece);
 spokenWords=safeCount;
}

function commitFinal(raw){
 const current=normalize(raw);
 if(!current)return;
 text.value=current;
 const W=words(current);
 const remaining=W.slice(Math.min(spokenWords,W.length)).join(" ");
 if(remaining)queueLatest(remaining);
 spokenWords=W.length;
}

function startRecognition(){
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR)throw new Error("Chrome Speech Recognition is unavailable. Use Google Chrome.");

 recognition=new SR();
 recognition.lang="en-US";
 recognition.continuous=true;
 recognition.interimResults=true;
 recognition.maxAlternatives=1;

 recognition.onstart=()=>setStatus("Listening — speak now.");
 recognition.onresult=e=>{
  for(let i=e.resultIndex;i<e.results.length;i++){
   const result=e.results[i],phrase=result[0]?.transcript?.trim();
   if(!phrase)continue;
   if(result.isFinal)commitFinal(phrase);
   else commitInterim(phrase);
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
  if(!running)return;
  clearTimeout(restartTimer);
  restartTimer=setTimeout(()=>{
   if(running){try{recognition.start();}catch{}}
  },40);
 };
 recognition.start();
}

function stopRecognition(){
 clearTimeout(restartTimer);restartTimer=null;
 try{recognition?.stop();}catch{}
 recognition=null;
}

async function startAll(){
 if(running)return;
 try{
  if(!reference.files?.[0])throw new Error("Choose your WAV voice reference first.");
  start.disabled=true;running=true;stop.disabled=false;
  text.value="";spokenWords=0;pendingPhrase="";generationToken++;
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
  running=false;stopRecognition();pendingPhrase="";generationToken++;
  try{ttsPlayer?.stop?.();}catch{}
  setStatus("Start error: "+(e.message||e));
  stop.disabled=true;updateStartButton();
 }
}

async function stopAll(){
 running=false;stopRecognition();pendingPhrase="";spokenWords=0;generationToken++;
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
