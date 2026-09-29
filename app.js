const $=id=>document.getElementById(id);
const reference=$("reference"),output=$("output"),chooseOutput=$("chooseOutput"),text=$("text"),start=$("start"),stop=$("stop"),status=$("status"),info=$("info"),meterBar=$("meterBar"),resultPlayer=$("resultPlayer"),resultInfo=$("resultInfo");
const TTS_URL="./pocket-tts/index.js";

let tts=null,voiceRef=null,ttsPlayer=null,running=false;
let recognition=null,restartTimer=null;
let spokenWords=0;
let latestResultChunks=[],latestResultToken=0,resultUrl="";

// Real microphone timing. This measures the actual incoming mic waveform rather
// than assuming a fixed TTS speed.
let micStream=null,micContext=null,micAnalyser=null,micTimer=null;
let micSpeechStart=0,micLastVoice=0,micSpeechActive=false,micLastQueuedElapsed=0;
const MIC_THRESHOLD=.022;
const MIC_SILENCE_MS=280;

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

async function startMicTiming(){
 if(!navigator.mediaDevices?.getUserMedia)throw new Error("Chrome microphone access is unavailable.");
 await stopMicTiming();
 micStream=await navigator.mediaDevices.getUserMedia({
  audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}
 });
 micContext=new AudioContext({latencyHint:"interactive"});
 micAnalyser=micContext.createAnalyser();
 micAnalyser.fftSize=1024;
 micAnalyser.smoothingTimeConstant=.12;
 const source=micContext.createMediaStreamSource(micStream);
 source.connect(micAnalyser);
 const data=new Float32Array(micAnalyser.fftSize);
 micSpeechStart=0;micLastVoice=0;micSpeechActive=false;micLastQueuedElapsed=0;
 const tick=()=>{
  if(!micAnalyser)return;
  micAnalyser.getFloatTimeDomainData(data);
  let sum=0;
  for(let i=0;i<data.length;i++)sum+=data[i]*data[i];
  const rms=Math.sqrt(sum/data.length);
  const now=performance.now();
  if(rms>=MIC_THRESHOLD){
   if(!micSpeechActive){
    micSpeechActive=true;
    micSpeechStart=now;
    micLastQueuedElapsed=0;
   }
   micLastVoice=now;
  }else if(micSpeechActive&&now-micLastVoice>=MIC_SILENCE_MS){
   micSpeechActive=false;
  }
  micTimer=requestAnimationFrame(tick);
 };
 tick();
}

function currentMicSpeechElapsed(){
 if(!micSpeechStart)return 0;
 const end=micSpeechActive?Math.max(micLastVoice,performance.now()):micLastVoice;
 return Math.max(0,(end-micSpeechStart)/1000);
}

async function stopMicTiming(){
 if(micTimer){cancelAnimationFrame(micTimer);micTimer=null;}
 try{micStream?.getTracks().forEach(t=>t.stop());}catch{}
 micStream=null;
 try{await micContext?.close();}catch{}
 micContext=null;micAnalyser=null;
 micSpeechActive=false;micSpeechStart=0;micLastVoice=0;micLastQueuedElapsed=0;
}

function takeChunkDuration(final=false){
 let total=currentMicSpeechElapsed();
 if(total<=0)return .75;
 let duration=final?total-micLastQueuedElapsed:total-micLastQueuedElapsed;
 if(final)duration+=.12;
 duration=Math.max(.22,duration);
 micLastQueuedElapsed=total;
 return duration;
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
 ttsPlayer=new mod.StreamingPlayer({sampleRate:tts.sampleRate,primeSeconds:.01,playbackRate:1});
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

let pendingPhrases=[];
let speechWorker=false;
let generationToken=0;

function queueLatest(s,targetDuration){
 s=normalize(s);
 if(!s)return;
 pendingPhrases.push({text:s,duration:Math.max(.22,Number(targetDuration)||.75)});
 if(pendingPhrases.length>3)pendingPhrases.splice(0,pendingPhrases.length-3);
 void drainSpeech();
}

function clampRate(rate){
 return Math.max(.5,Math.min(2.5,Number(rate)||1));
}

async function drainSpeech(){
 if(speechWorker)return;
 speechWorker=true;
 try{
  while(running&&pendingPhrases.length){
   const item=pendingPhrases.shift();
   const phrase=item.text;
   const targetDuration=item.duration;
   const token=++generationToken;
   latestResultChunks=[];
   latestResultToken=token;
   setStatus("Generating: "+phrase);
   await tts.generate(phrase,{
    voice:voiceRef,
    onChunk:(audio,meta)=>{
     if(running&&token===generationToken){
      latestResultChunks.push(audio instanceof Float32Array?audio.slice():new Float32Array(audio));
     }
    }
   });
   if(running&&token===generationToken&&latestResultChunks.length){
    const generatedSamples=latestResultChunks.reduce((n,x)=>n+x.length,0);
    const generatedDuration=generatedSamples/tts.sampleRate;
    const rate=clampRate(generatedDuration/targetDuration);
    ttsPlayer?.setPlaybackRate?.(rate);
    for(const chunk of latestResultChunks)ttsPlayer?.play(chunk);
    ttsPlayer?.flush();

    const blob=modToWavBlob(latestResultChunks,tts.sampleRate);
    if(resultUrl)URL.revokeObjectURL(resultUrl);
    resultUrl=URL.createObjectURL(blob);
    resultPlayer.src=resultUrl;
    resultPlayer.playbackRate=rate;
    resultPlayer.preservesPitch=true;
    resultInfo.textContent="Matched mic timing • mic "+targetDuration.toFixed(2)+"s → TTS "+generatedDuration.toFixed(2)+"s • "+Math.round(rate*100)+"% playback";
    setStatus("Listening — matched to your speaking time.");
   }
  }
 }catch(e){
  if(running)setStatus("PocketTTS error: "+(e.message||e));
 }finally{
  speechWorker=false;
  if(running&&pendingPhrases.length)void drainSpeech();
  else if(running)setStatus("Listening — speak now.");
 }
}

function modToWavBlob(chunks,sampleRate){
 const list=(chunks||[]).filter(x=>x?.length);
 const total=list.reduce((n,x)=>n+x.length,0);
 const pcm=new Int16Array(total);
 let offset=0;
 for(const chunk of list){
  for(let i=0;i<chunk.length;i++){
   const s=Math.max(-1,Math.min(1,chunk[i]));
   pcm[offset++]=s<0?s*32768:s*32767;
  }
 }
 const buf=new ArrayBuffer(44+pcm.length*2),view=new DataView(buf);
 const write=(pos,str)=>{for(let i=0;i<str.length;i++)view.setUint8(pos+i,str.charCodeAt(i));};
 write(0,"RIFF");view.setUint32(4,36+pcm.length*2,true);write(8,"WAVE");
 write(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);
 view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);
 view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
 write(36,"data");view.setUint32(40,pcm.length*2,true);
 new Uint8Array(buf,44).set(new Uint8Array(pcm.buffer));
 return new Blob([buf],{type:"audio/wav"});
}

function commitInterim(raw){
 const current=normalize(raw);
 if(!current)return;
 text.value=current;
 const W=words(current);
 // Start producing after a few words, but do not wait for the entire sentence.
 const safeCount=Math.max(0,W.length-1);
 if(safeCount<=spokenWords)return;
 const piece=W.slice(spokenWords,safeCount).join(" ");
 if(piece)queueLatest(piece,takeChunkDuration(false));
 spokenWords=safeCount;
}

function commitFinal(raw){
 const current=normalize(raw);
 if(!current)return;
 text.value=current;
 const W=words(current);
 const remaining=W.slice(Math.min(spokenWords,W.length)).join(" ");
 if(remaining)queueLatest(remaining,takeChunkDuration(true));
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
  text.value="";spokenWords=0;pendingPhrases=[];generationToken++;
  latestResultChunks=[];
  setStatus("Opening your microphone…");
  await startMicTiming();
  await initTTS();
  if(!running)return;
  await prepareVoice();
  if(!running)return;
  await loadOutputs();await setOutput();
  startRecognition();
  setStatus("Listening — your mic timing is now tracked automatically.");
 }catch(e){
  console.error(e);
  running=false;stopRecognition();pendingPhrases=[];generationToken++;
  try{ttsPlayer?.stop?.();}catch{}
  await stopMicTiming();
  setStatus("Start error: "+(e.message||e));
  stop.disabled=true;updateStartButton();
 }
}

async function stopAll(){
 running=false;stopRecognition();pendingPhrases=[];spokenWords=0;generationToken++;
 try{await tts?.stop();}catch{}
 try{ttsPlayer?.stop?.();}catch{}
 await stopMicTiming();
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
