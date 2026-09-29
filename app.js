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
    const stretched=matchDurationPitchSafe(latestResultChunks,tts.sampleRate,targetDuration);
    // The WAV itself is now the target duration. Playback stays at normal 1× speed.
    ttsPlayer?.setPlaybackRate?.(1);
    ttsPlayer?.play(stretched);
    ttsPlayer?.flush();

    const blob=modToWavBlob([stretched],tts.sampleRate);
    if(resultUrl)URL.revokeObjectURL(resultUrl);
    resultUrl=URL.createObjectURL(blob);
    resultPlayer.src=resultUrl;
    resultPlayer.playbackRate=1;
    resultPlayer.preservesPitch=true;
    resultInfo.textContent="WAV duration matched • mic "+targetDuration.toFixed(2)+"s → file "+(stretched.length/tts.sampleRate).toFixed(2)+"s • normal pitch / 1× speed";
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

function matchDurationPitchSafe(chunks,sampleRate,targetSeconds){
 const list=(chunks||[]).filter(x=>x?.length);
 const total=list.reduce((n,x)=>n+x.length,0);
 if(!total)return new Float32Array(0);
 const input=new Float32Array(total);
 let at=0;
 for(const x of list){input.set(x,at);at+=x.length;}
 const requestedTarget=Math.max(0.18,Number(targetSeconds)||input.length/sampleRate);
 // Do not force a generated sentence to race unnaturally fast. The WAV still
 // follows the user's timing, but we keep the compression within a natural
 // range so full sentences remain intelligible.
 const generatedSeconds=input.length/sampleRate;
 const minimumNaturalSeconds=generatedSeconds*.72;
 const target=Math.max(requestedTarget,minimumNaturalSeconds);
 const targetLength=Math.max(1,Math.round(target*sampleRate));
 if(targetLength===input.length)return input;

 // Pitch-preserving granular time stretch. The waveform is rebuilt at the
 // requested duration while keeping playback at 1×, so speeding it up does
 // not turn the cloned voice into a chipmunk.
 const grain=Math.max(256,Math.min(Math.round(sampleRate*.045),Math.floor(input.length/2)));
 const overlap=Math.floor(grain*.5);
 const analysisStep=Math.max(64,grain-overlap);
 const synthesisStep=Math.max(64,Math.round(analysisStep*targetLength/input.length));
 const output=new Float32Array(targetLength+grain);
 const weights=new Float32Array(targetLength+grain);
 let outPos=0,srcPos=0;
 while(outPos<targetLength){
  const center=Math.min(Math.max(0,Math.round(srcPos)),Math.max(0,input.length-grain));
  for(let i=0;i<grain;i++){
   const idx=center+i;
   if(idx>=input.length)break;
   const w=.5-.5*Math.cos(2*Math.PI*i/(grain-1));
   output[outPos+i]+=input[idx]*w;
   weights[outPos+i]+=w;
  }
  outPos+=synthesisStep;
  srcPos+=analysisStep;
 }
 const result=new Float32Array(targetLength);
 for(let i=0;i<targetLength;i++){
  result[i]=weights[i]>.00001?Math.max(-1,Math.min(1,output[i]/weights[i])):0;
 }
 // Fade only the tiny boundary regions to avoid clicks.
 const fade=Math.min(Math.floor(sampleRate*.008),Math.floor(result.length/2));
 for(let i=0;i<fade;i++){
  const w=i/fade;
  result[i]*=w;
  result[result.length-1-i]*=w;
 }
 return result;
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
 // Show the live sentence, but DO NOT generate partial phrases.
 // This keeps the cloned voice from speaking word-by-word.
 text.value=current;
}

function commitFinal(raw){
 const current=normalize(raw);
 if(!current)return;
 text.value=current;

 // Generate the COMPLETE recognized sentence as one unit. Its target WAV
 // duration is the actual amount of time spent speaking since the mic speech
 // segment began, so the resulting file matches the user's sentence timing.
 const duration=takeChunkDuration(true);
 queueLatest(current,duration);
 spokenWords=words(current).length;
}

let recognitionGeneration=0;

function startRecognition(){
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!SR)throw new Error("Chrome Speech Recognition is unavailable. Use Google Chrome.");
 clearTimeout(restartTimer);
 restartTimer=null;
 const generation=++recognitionGeneration;
 // Every new Chrome recognition session has a brand-new transcript. Reset only
 // the word cursor; the cloned WAV voiceRef and PocketTTS engine stay intact.
 if(generation>1)spokenWords=0;
 const r=new SR();
 recognition=r;
 r.lang="en-US";
 r.continuous=true;
 r.interimResults=true;
 r.maxAlternatives=1;
 r.onstart=()=>{
  if(running&&generation===recognitionGeneration)setStatus("Listening — speak now.");
 };
 r.onresult=e=>{
  if(generation!==recognitionGeneration)return;
  for(let i=e.resultIndex;i<e.results.length;i++){
   const result=e.results[i],phrase=result[0]?.transcript?.trim();
   if(!phrase)continue;
   if(result.isFinal)commitFinal(phrase);
   else commitInterim(phrase);
  }
 };
 r.onerror=e=>{
  console.warn("SpeechRecognition:",e.error);
  if(e.error==="not-allowed"||e.error==="service-not-allowed"){
   setStatus("Chrome microphone/speech permission was denied.");
   running=false;stopRecognition();updateStartButton();stop.disabled=true;return;
  }
  if(running&&generation===recognitionGeneration)setStatus("Reconnecting speech recognition…");
 };
 r.onend=()=>{
  if(!running||generation!==recognitionGeneration)return;
  // Chrome frequently ends continuous recognition on its own. Do NOT reuse
  // the ended object: create a completely fresh session instead.
  if(recognition===r)recognition=null;
  clearTimeout(restartTimer);
  restartTimer=setTimeout(()=>{
   if(!running||generation!==recognitionGeneration)return;
   try{
    startRecognition();
   }catch(e){
    console.warn("SpeechRecognition restart:",e);
    if(running)setStatus("Reconnecting speech recognition…");
    clearTimeout(restartTimer);
    restartTimer=setTimeout(()=>{if(running)startRecognition();},500);
   }
  },150);
 };
 try{
  r.start();
 }catch(e){
  if(running){
   console.warn("SpeechRecognition start:",e);
   clearTimeout(restartTimer);
   restartTimer=setTimeout(()=>{if(running)startRecognition();},300);
  }else throw e;
 }
}

function stopRecognition(){
 clearTimeout(restartTimer);restartTimer=null;
 ++recognitionGeneration;
 const r=recognition;
 recognition=null;
 try{r?.stop();}catch{}
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
