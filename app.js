const $=id=>document.getElementById(id);
const mic=$("mic"),output=$("output"),start=$("start"),stop=$("stop");
const status=$("status"),transcript=$("transcript"),player=$("player");

let stream=null,ctx=null,source=null,processor=null,silentGain=null;
let listening=false,buffer=[],bufferSamples=0,processing=false;

function setStatus(v){status.textContent=v;}

async function loadDevices(){
  const devices=await navigator.mediaDevices.enumerateDevices();
  mic.innerHTML=""; output.innerHTML="";
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
}

function resample(samples,from,to){
  if(from===to)return samples;
  const ratio=from/to, n=Math.max(1,Math.round(samples.length/ratio));
  const out=new Float32Array(n);
  for(let i=0;i<n;i++){
    const pos=i*ratio, a=Math.floor(pos), b=Math.min(a+1,samples.length-1), f=pos-a;
    out[i]=samples[a]*(1-f)+samples[b]*f;
  }
  return out;
}

function concatFloat32(chunks,total){
  const out=new Float32Array(total);let p=0;
  for(const c of chunks){out.set(c,p);p+=c.length}
  return out;
}

async function sendSpeech(samples,sampleRate){
  if(processing)return;
  processing=true;
  try{
    setStatus("Recognizing your sentence locally…");
    const r=await fetch("/stt",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({samples:Array.from(samples),sampleRate})});
    if(!r.ok)throw new Error(await r.text());
    const j=await r.json();
    const heard=(j.text||"").trim();
    if(!heard){setStatus("I didn't catch that — keep listening.");return}
    transcript.textContent="Heard: "+heard;
    setStatus("PocketTTS is echoing it…");
    const t=await fetch("/tts",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({text:heard})});
    if(!t.ok)throw new Error(await t.text());
    const blob=await t.blob();
    const old=player.src;
    player.src=URL.createObjectURL(blob);
    if(old)URL.revokeObjectURL(old);
    if(typeof player.setSinkId==="function"&&output.value)await player.setSinkId(output.value);
    await player.play();
    setStatus("Echo playing — say another sentence.");
  }catch(e){setStatus("Local speech error: "+e.message)}
  finally{processing=false}
}

async function startListening(){
  if(listening)return;
  try{
    stopListening();
    stream=await navigator.mediaDevices.getUserMedia({
      audio:{deviceId:mic.value?{exact:mic.value}:undefined,channelCount:1,
      echoCancellation:false,noiseSuppression:false,autoGainControl:false}
    });
    ctx=new AudioContext();
    await ctx.resume();
    source=ctx.createMediaStreamSource(stream);

    // ScriptProcessor is used here deliberately for a tiny, dependency-free local app.
    processor=ctx.createScriptProcessor(2048,1,1);
    silentGain=ctx.createGain();silentGain.gain.value=0;
    source.connect(processor).connect(silentGain).connect(ctx.destination);

    buffer=[];bufferSamples=0;listening=true;
    start.disabled=true;stop.disabled=false;
    setStatus("Listening… speak a sentence, then pause briefly.");
    processor.onaudioprocess=e=>{
      if(!listening||processing)return;
      const x=new Float32Array(e.inputBuffer.getChannelData(0));
      buffer.push(x);bufferSamples+=x.length;
      // Keep a bounded rolling window; STT is triggered by the silence detector below.
      if(bufferSamples>ctx.sampleRate*12){
        const all=concatFloat32(buffer,bufferSamples);
        buffer=[all.slice(all.length-Math.floor(ctx.sampleRate*8))];
        bufferSamples=buffer[0].length;
      }
      let sum=0;
      for(let i=0;i<x.length;i++)sum+=x[i]*x[i];
      const rms=Math.sqrt(sum/x.length);
      silenceFrames=rms<0.012?silenceFrames+1:0;
      if(bufferSamples>ctx.sampleRate*0.7 && silenceFrames>Math.ceil(ctx.sampleRate/2048*0.8)){
        const all=concatFloat32(buffer,bufferSamples);
        buffer=[];bufferSamples=0;silenceFrames=0;
        sendSpeech(resample(all,ctx.sampleRate,16000),16000);
      }
    };
  }catch(e){setStatus("Microphone error: "+e.message)}
}

let silenceFrames=0;
function stopListening(){
  listening=false;silenceFrames=0;
  if(processor){processor.onaudioprocess=null;try{processor.disconnect()}catch{}processor=null}
  if(source){try{source.disconnect()}catch{}source=null}
  if(silentGain){try{silentGain.disconnect()}catch{}silentGain=null}
  if(ctx){try{ctx.close()}catch{}ctx=null}
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
  start.disabled=false;stop.disabled=true;
}

start.onclick=startListening;
stop.onclick=()=>{stopListening();setStatus("Stopped.");};

output.onchange=async()=>{
  if(typeof player.setSinkId==="function"&&output.value){
    try{await player.setSinkId(output.value)}catch(e){}
  }
};

navigator.mediaDevices.addEventListener?.("devicechange",loadDevices);

(async()=>{
  try{await navigator.mediaDevices.getUserMedia({audio:true})}catch{}
  await loadDevices();
  try{
    const r=await fetch("/health",{cache:"no-store"}),j=await r.json();
    setStatus(j.ok?"Ready — press START LISTENING.":j.error||"Speech stack is starting…");
  }catch{setStatus("Open the local app through its local server.")}
})();