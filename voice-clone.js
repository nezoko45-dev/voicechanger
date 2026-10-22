(() => {
 const API="http://127.0.0.1:8765";
 const $=s=>document.querySelector(s);
 const health=$("#health"),status=$("#status"),referenceInput=$("#reference"),saveReference=$("#saveReference"),referenceStatus=$("#referenceStatus"),startButton=$("#start"),stopButton=$("#stop"),micStatus=$("#micStatus"),levelBar=$("#level"),clips=$("#clips");
 let referenceReady=false,stream=null,audioContext=null,processor=null,source=null,recording=false,frames=[],preRoll=[],phraseActive=false,phraseSamples=0,silenceSamples=0,clipNumber=0,processing=0,referenceName="";
 const TARGET_SILENCE=0.85,MIN_PHRASE_SECONDS=0.38,MAX_PHRASE_SECONDS=15,PRE_ROLL_SECONDS=0.20,THRESHOLD=0.014;
 function setStatus(text){status.textContent=text;}
 async function checkHealth(){
  try{const r=await fetch(API+"/health");if(!r.ok)throw Error("HTTP "+r.status);const data=await r.json();health.textContent=data.reference_ready?"Local helper ready · reference WAV is saved.":"Local helper ready · choose a reference WAV below.";health.style.color="#7ce9be";referenceReady=!!data.reference_ready;referenceStatus.textContent=referenceReady?"A reference WAV is saved locally.": "No reference WAV saved yet.";saveReference.disabled=!referenceInput.files.length;startButton.disabled=!referenceReady;setStatus(referenceReady?"Ready to record and convert phrases.":"Choose and save a reference WAV to begin.");}
  catch(e){health.textContent="Local helper not reachable. Start it with: python voiceclonnx_helper/server.py";health.style.color="#ffaaaa";startButton.disabled=true;saveReference.disabled=!referenceInput.files.length;setStatus("Waiting for the local VoiceClonNX helper.");}
 }
 referenceInput.addEventListener("change",()=>{saveReference.disabled=!referenceInput.files.length;referenceStatus.textContent=referenceInput.files[0]?.name||"No file selected.";});
 saveReference.addEventListener("click",async()=>{
  const file=referenceInput.files[0];if(!file)return;if(!file.name.toLowerCase().endsWith(".wav")){setStatus("Please choose a WAV file.");return;}
  saveReference.disabled=true;referenceStatus.textContent="Uploading reference to local helper…";
  try{const form=new FormData();form.append("file",file,file.name);const r=await fetch(API+"/reference",{method:"POST",body:form});const data=await r.json();if(!r.ok)throw Error(data.detail||"Reference upload failed.");referenceReady=true;referenceName=file.name;referenceStatus.textContent="Saved locally: "+file.name;setStatus("Reference voice saved. Start the microphone when ready.");startButton.disabled=false;}
  catch(e){referenceStatus.textContent="Could not save reference.";setStatus("Reference upload failed: "+e.message);}
  finally{saveReference.disabled=!referenceInput.files.length;}
 });
 function wavBlob(samples,sampleRate){
  const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
  const write=(offset,s)=>{for(let i=0;i<s.length;i++)view.setUint8(offset+i,s.charCodeAt(i));};
  write(0,"RIFF");view.setUint32(4,36+samples.length*2,true);write(8,"WAVE");write(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,"data");view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){const s=Math.max(-1,Math.min(1,samples[i]));view.setInt16(44+i*2,s<0?s*32768:s*32767,true);}
  return new Blob([buffer],{type:"audio/wav"});
 }
 function merge(chunks){let n=0;for(const a of chunks)n+=a.length;const out=new Float32Array(n);let p=0;for(const a of chunks){out.set(a,p);p+=a.length;}return out;}
 function addClip(blob,filename){
  clipNumber++;if(clips.querySelector("p"))clips.replaceChildren();
  const url=URL.createObjectURL(blob),card=document.createElement("div");card.className="clip";
  const title=document.createElement("strong");title.textContent="Phrase "+clipNumber+" · "+filename;
  const audio=document.createElement("audio");audio.controls=true;audio.src=url;
  const link=document.createElement("a");link.href=url;link.download=filename;link.textContent="Download WAV";
  card.append(title,audio,link);clips.prepend(card);
 }
 async function convertPhrase(samples,sampleRate){
  if(samples.length/sampleRate<MIN_PHRASE_SECONDS)return;
  processing++;setStatus("Converting phrase locally… ("+processing+" in progress)");
  try{
   const wav=wavBlob(samples,sampleRate),form=new FormData();form.append("file",wav,"phrase.wav");
   const r=await fetch(API+"/convert",{method:"POST",body:form});
   if(!r.ok){let msg="Conversion failed (HTTP "+r.status+")";try{msg=(await r.json()).detail||msg;}catch{}throw Error(msg);}
   const blob=await r.blob();const filename="voice-clone-"+new Date().toISOString().replace(/[:.]/g,"-")+".wav";addClip(blob,filename);setStatus("Converted phrase ready. Keep speaking or pause for another phrase.");
  }catch(e){setStatus("Conversion error: "+e.message);}
  finally{processing=Math.max(0,processing-1);}
 }
 function endPhrase(){
  if(!phraseActive)return;
  phraseActive=false;silenceSamples=0;
  const data=merge(frames);frames=[];phraseSamples=0;
  if(data.length)void convertPhrase(data,audioContext.sampleRate);
 }
 function onAudio(event){
  if(!recording)return;
  const input=event.inputBuffer.getChannelData(0),copy=new Float32Array(input);
  let sum=0;for(let i=0;i<copy.length;i++)sum+=copy[i]*copy[i];const rms=Math.sqrt(sum/copy.length);
  levelBar.style.width=Math.min(100,Math.round(rms*700))+"%";
  const preMax=Math.ceil(audioContext.sampleRate*PRE_ROLL_SECONDS/2048)+1;preRoll.push(copy);while(preRoll.length>preMax)preRoll.shift();
  if(rms>THRESHOLD){
   if(!phraseActive){phraseActive=true;frames=preRoll.slice();phraseSamples=frames.reduce((n,a)=>n+a.length,0);setStatus("Speech detected…");}
   else frames.push(copy);
   phraseSamples+=phraseActive&&frames.length===preRoll.length?0:copy.length;
   silenceSamples=0;
  }else if(phraseActive){
   frames.push(copy);phraseSamples+=copy.length;silenceSamples+=copy.length;
   if(silenceSamples/audioContext.sampleRate>=TARGET_SILENCE||phraseSamples/audioContext.sampleRate>=MAX_PHRASE_SECONDS)endPhrase();
  }
 }
 async function startMic(){
  if(!referenceReady){setStatus("Save a reference WAV before recording.");return;}
  try{
   stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
   audioContext=new AudioContext();source=audioContext.createMediaStreamSource(stream);processor=audioContext.createScriptProcessor(2048,1,1);
   processor.onaudioprocess=onAudio;source.connect(processor);processor.connect(audioContext.destination);
   recording=true;startButton.disabled=true;stopButton.disabled=false;micStatus.textContent="Listening";setStatus("Listening. Pause briefly after each phrase to convert it.");await audioContext.resume();
  }catch(e){setStatus("Could not start microphone: "+e.message+" — check browser microphone permission.");await stopMic();}
 }
 async function stopMic(){
  recording=false;levelBar.style.width="0";if(phraseActive)endPhrase();
  if(processor){processor.onaudioprocess=null;processor.disconnect();processor=null;}if(source){source.disconnect();source=null;}
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}if(audioContext){try{await audioContext.close();}catch{}audioContext=null;}
  frames=[];preRoll=[];phraseActive=false;silenceSamples=0;startButton.disabled=!referenceReady;stopButton.disabled=true;micStatus.textContent="Microphone off";setStatus(processing?"Microphone stopped; waiting for conversion to finish.":"Microphone stopped.");
 }
 startButton.addEventListener("click",startMic);stopButton.addEventListener("click",stopMic);
 $("#clear").addEventListener("click",()=>{for(const audio of clips.querySelectorAll("audio"))if(audio.src.startsWith("blob:"))URL.revokeObjectURL(audio.src);clips.replaceChildren(Object.assign(document.createElement("p"),{textContent:"Your converted phrases will appear here.",className:"muted"}));clipNumber=0;});
 window.addEventListener("beforeunload",()=>{if(stream)stream.getTracks().forEach(t=>t.stop());});
 checkHealth();setInterval(checkHealth,10000);
})();