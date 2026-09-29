const $=id=>document.getElementById(id);
const key=$("key"),reference=$("reference"),output=$("output"),chooseOutput=$("chooseOutput"),text=$("text"),start=$("start"),stop=$("stop"),status=$("status"),info=$("info");

const AGENT_URL="wss://agent.deepgram.com/v1/agent/converse";
const TTS_URL="./pocket-tts/index.js";
const TARGET_RATE=16000;

let socket=null,micStream=null,micContext=null,micSource=null,processor=null,muteGain=null;
let agentReady=false;
let tts=null,voiceRef=null,ttsPlayer=null,running=false,ttsBusy=false,ttsQueue=[];
let reconnectTimer=null,reconnectDelay=500,reconnectGeneration=0,keepAliveTimer=null;

function setStatus(v){status.textContent=v;}
function updateStartButton(){start.disabled=!(reference.files?.[0]&&!running);}
async function setOutput(){
 if(ttsPlayer?.setSinkId){try{await ttsPlayer.setSinkId(output.value||"");}catch(e){console.warn(e);}}
}
async function loadOutputs(){
 if(!navigator.mediaDevices?.enumerateDevices)return;
 try{
  const devices=await navigator.mediaDevices.enumerateDevices(),old=output.value;
  output.innerHTML="<option value=''>Default Windows output</option>";
  for(const d of devices.filter(x=>x.kind==="audiooutput")){
   const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||"Speaker / output "+output.options.length;output.appendChild(o);
  }
  if([...output.options].some(x=>x.value===old))output.value=old;
 }catch(e){}
}
async function chooseChromeSpeaker(){
 if(!navigator.mediaDevices?.selectAudioOutput){setStatus("Chrome speaker picker unavailable; using the default output.");return;}
 try{
  const d=await navigator.mediaDevices.selectAudioOutput();
  if(d?.deviceId){output.innerHTML="";const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||"Selected Chrome speaker";output.appendChild(o);await setOutput();setStatus("Speaker selected.");}
 }catch(e){if(e.name!=="NotAllowedError")setStatus("Speaker picker error: "+e.message);}
}
async function initTTS(){
 if(tts)return;
 const mod=await import(TTS_URL);
 tts=new mod.PocketTTS({language:"english_2026-04",quantized:true,voiceCloning:true,cache:true,maxThreads:8,maxReferenceSeconds:6});
 ttsPlayer=new mod.StreamingPlayer({sampleRate:tts.sampleRate});
 await ttsPlayer.resume();
 setStatus("Loading PocketTTS models…");
 await tts.load(p=>{if(p?.label)setStatus("PocketTTS: "+p.label);});
 await setOutput();
}
async function prepareVoice(){
 const file=reference.files?.[0];if(!file)throw new Error("Choose your WAV voice reference first.");
 const buf=await file.arrayBuffer(),ac=new AudioContext();
 try{
  const decoded=await ac.decodeAudioData(buf);
  setStatus("Cloning your WAV voice…");
  voiceRef=await tts.cloneVoice(decoded.getChannelData(0).slice(),{inputSampleRate:decoded.sampleRate,name:"pockettts-mic-clone"});
 }finally{await ac.close();}
 await tts.finishLoad();
 info.textContent="Chrome mic → Speech Recognition → PocketTTS clone → Chrome speaker.";
}
async function speak(phrase){
 phrase=phrase.trim();if(!running||!phrase)return;
 ttsQueue.push(phrase);if(ttsBusy)return;
 ttsBusy=true;
 try{
  while(running&&ttsQueue.length){
   const current=ttsQueue.shift();setStatus("PocketTTS speaking…");
   await tts.generate(current,{voice:voiceRef,onChunk:(audio,meta)=>{if(running)ttsPlayer.play(audio,meta);}});
   if(running)ttsPlayer.flush();
  }
 }catch(e){console.error(e);if(running)setStatus("PocketTTS error: "+(e.message||e));}
 finally{ttsBusy=false;if(running)setStatus("Listening…");}
}
function startRecognition(){
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR)throw new Error("Chrome Speech Recognition is unavailable. Use Google Chrome.");
 recognition=new SR();recognition.lang="en-US";recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=1;
 recognition.onstart=()=>setStatus("Listening…");
 recognition.onresult=e=>{
  let interim="";
  for(let i=e.resultIndex;i<e.results.length;i++){
   const r=e.results[i];
   if(r.isFinal){text.value=r[0].transcript;void speak(r[0].transcript);}
   else interim+=r[0].transcript;
  }
  if(interim)text.value=interim;
 };
 recognition.onerror=e=>{
  if(e.error==="not-allowed"||e.error==="service-not-allowed"){setStatus("Microphone/speech recognition permission denied.");return;}
  if(running)setStatus("Speech recognition reconnecting…");
 };
 recognition.onend=()=>{
  if(!running)return;
  clearTimeout(recognitionRestartTimer);
  recognitionRestartTimer=setTimeout(()=>{if(running){try{recognition.start();}catch{}}},30);
 };
 recognition.start();
}
async function startMic(){
 micStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
}
function stopMic(){
 micStream?.getTracks().forEach(t=>t.stop());micStream=null;
 clearTimeout(recognitionRestartTimer);recognitionRestartTimer=null;
 try{recognition?.stop();}catch{}recognition=null;
}
async function startAll(){
 if(running)return;
 try{
  if(!reference.files?.[0])throw new Error("Choose your WAV voice reference first.");
  start.disabled=true;setStatus("Loading PocketTTS…");
  await initTTS();await prepareVoice();await loadOutputs();await setOutput();await startMic();
  running=true;stop.disabled=false;startRecognition();
 }catch(e){
  console.error(e);running=false;stop.disabled=true;stopMic();
  if(ttsPlayer){try{await ttsPlayer.destroy();}catch{}ttsPlayer=null;}
  setStatus("Start error: "+(e.message||e));updateStartButton();
 }
}
async function stopAll(){
 running=false;stopMic();ttsQueue=[];if(tts){try{await tts.stop();}catch{}}
 if(ttsPlayer){try{await ttsPlayer.destroy();}catch{}ttsPlayer=null;}
 stop.disabled=true;updateStartButton();setStatus("Stopped. Raw microphone audio is never played.");
}
reference.onchange=updateStartButton;start.onclick=()=>void startAll();stop.onclick=()=>void stopAll();chooseOutput.onclick=chooseChromeSpeaker;output.onchange=()=>void setOutput();navigator.mediaDevices?.addEventListener?.("devicechange",loadOutputs);void loadOutputs();updateStartButton();