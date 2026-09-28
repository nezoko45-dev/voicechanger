const $=id=>document.getElementById(id);
const mic=$("mic"),output=$("output"),start=$("start"),stop=$("stop");
const status=$("status"),transcript=$("transcript"),player=$("player");

let tts=null,voice=null,recognition=null,listening=false,busy=false,stream=null;
let lastWavUrl=null;

function setStatus(v){status.textContent=v;}

async function loadDevices(){
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    mic.innerHTML="";
    output.innerHTML="";
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
  }catch(e){console.warn(e)}
}

async function setOutput(){
  if(typeof player.setSinkId==="function"&&output.value){
    try{await player.setSinkId(output.value)}catch(e){console.warn(e)}
  }
}

async function loadPocketTTS(){
  if(tts)return;
  setStatus("Loading browser PocketTTS model… first load can take a while.");
  const mod=await import("./pocket-tts/index.js");
  tts=new mod.PocketTTS({
    language:"english_2026-04",
    quantized:true,
    voiceCloning:true,
    cache:true,
    modelBaseUrl:"https://huggingface.co/akrv/pocket-tts-onnx/resolve/main/onnx",
    ortBaseUrl:"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/"
  });
  await tts.load(p=>{
    if(p.total){
      const pct=Math.round(p.loaded/p.total*100);
      setStatus(`Loading PocketTTS: ${pct}% — ${p.label||"model"}`);
    }
  });

  const refUrl=new URL("./Recording%20(10).wav",location.href);
  const response=await fetch(refUrl);
  if(!response.ok)throw new Error("Recording (10).wav could not be loaded from GitHub Pages.");
  const bytes=await response.arrayBuffer();
  const audioCtx=new AudioContext();
  const decoded=await audioCtx.decodeAudioData(bytes);
  const mono=decoded.getChannelData(0).slice();
  voice=await tts.cloneVoice(mono,{inputSampleRate:decoded.sampleRate,name:"recording-10"});
  await audioCtx.close();
  setStatus("PocketTTS ready.");
}

async function speak(text){
  if(!text||busy)return;
  busy=true;
  try{
    if(recognition){try{recognition.stop()}catch{}}
    setStatus("Converting your sentence to the cloned voice…");
    await setOutput();

    const chunks=[];
    await tts.generate(text,{
      voice,
      onChunk:audio=>{
        if(audio&&audio.length)chunks.push(audio);
      }
    });

    if(!chunks.length)throw new Error("PocketTTS returned no audio.");

    // PocketTTS can stream multiple PCM chunks. Keep them in memory and
    // turn the entire sentence into one WAV before playback.
    const fadeSamples=Math.max(1,Math.round(tts.sampleRate*0.004));
    const usable=chunks.filter(c=>c&&c.length);
    let total=usable.reduce((n,c)=>n+c.length,0);
    for(let i=1;i<usable.length;i++){
      total-=Math.min(fadeSamples,usable[i-1].length,usable[i].length);
    }

    const sentence=new Float32Array(total);
    let offset=0;

    for(let i=0;i<usable.length;i++){
      const chunk=usable[i];

      if(i===0){
        sentence.set(chunk,offset);
        offset+=chunk.length;
        continue;
      }

      const prev=usable[i-1];
      const fade=Math.min(fadeSamples,prev.length,chunk.length);
      const start=offset-fade;

      // Tiny equal-power-ish crossfade prevents clicks between model chunks.
      for(let j=0;j<fade;j++){
        const t=(j+1)/(fade+1);
        const a=Math.cos(t*Math.PI*0.5);
        const b=Math.sin(t*Math.PI*0.5);
        sentence[start+j]=prev[prev.length-fade+j]*a+chunk[j]*b;
      }

      sentence.set(chunk.subarray(fade),offset);
      offset+=chunk.length-fade;
    }

    if(lastWavUrl)URL.revokeObjectURL(lastWavUrl);
    lastWavUrl=makeWavUrl(sentence,tts.sampleRate);

    player.src=lastWavUrl;
    player.currentTime=0;
    player.loop=false;
    setStatus("Playing converted sentence…");

    await player.play();

    await new Promise(resolve=>{
      const done=()=>{
        player.removeEventListener("ended",done);
        resolve();
      };
      player.addEventListener("ended",done,{once:true});
    });

    setStatus("Voice changer ready — say another sentence.");
  }catch(e){
    console.error(e);
    setStatus("PocketTTS error: "+e.message);
  }finally{
    busy=false;
    if(listening)startRecognition();
  }
}

function makeWavUrl(samples,rate){
  const data=new DataView(new ArrayBuffer(44+samples.length*2));
  data.setUint8(0,82);data.setUint8(1,73);data.setUint8(2,70);data.setUint8(3,70);
  data.setUint32(4,36+samples.length*2,true);
  data.setUint8(8,87);data.setUint8(9,65);data.setUint8(10,86);data.setUint8(11,69);
  data.setUint8(12,102);data.setUint8(13,109);data.setUint8(14,116);data.setUint8(15,32);
  data.setUint32(16,16,true);data.setUint16(20,1,true);data.setUint16(22,1,true);
  data.setUint32(24,rate,true);data.setUint32(28,rate*2,true);
  data.setUint16(32,2,true);data.setUint16(34,16,true);
  data.setUint8(36,100);data.setUint8(37,97);data.setUint8(38,116);data.setUint8(39,97);
  data.setUint32(40,samples.length*2,true);

  for(let i=0;i<samples.length;i++){
    const v=Math.max(-1,Math.min(1,samples[i]));
    data.setInt16(44+i*2,v<0?v*32768:v*32767,true);
  }

  return URL.createObjectURL(new Blob([data.buffer],{type:"audio/wav"}));
}

function startRecognition(){
  if(!listening||busy)return;

  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){
    setStatus("Chrome speech recognition is not available in this browser.");
    return;
  }

  recognition=new SR();
  recognition.lang="en-US";
  recognition.continuous=true;
  recognition.interimResults=false;
  recognition.maxAlternatives=1;

  recognition.onresult=async e=>{
    const result=e.results[e.results.length-1];
    if(!result.isFinal)return;

    const text=result[0].transcript.trim();
    if(!text)return;

    transcript.textContent="Heard: "+text;
    await speak(text);
  };

  recognition.onerror=e=>{
    if(e.error==="not-allowed"||e.error==="service-not-allowed"){
      setStatus("Microphone/speech permission was blocked. Allow microphone access for this GitHub Pages site, then press START again.");
    }else if(e.error!=="aborted"){
      setStatus("Speech recognition: "+e.error);
    }
  };

  recognition.onend=()=>{
    recognition=null;
    if(listening&&!busy)setTimeout(startRecognition,100);
  };

  try{recognition.start()}catch(e){}
}

async function startListening(){
  if(listening)return;

  try{
    start.disabled=true;
    setStatus("Requesting microphone permission…");

    stream=await navigator.mediaDevices.getUserMedia({
      audio:{
        deviceId:mic.value?{exact:mic.value}:undefined,
        channelCount:1,
        echoCancellation:true,
        noiseSuppression:true,
        autoGainControl:true
      }
    });

    await loadDevices();
    await loadPocketTTS();

    listening=true;
    stop.disabled=false;
    setStatus("Listening… say a sentence.");
    startRecognition();
  }catch(e){
    console.error(e);
    listening=false;
    stop.disabled=true;
    start.disabled=false;

    setStatus(e.name==="NotAllowedError"
      ?"Microphone permission was blocked. Click the lock/site-permissions icon in Chrome, allow Microphone, then press START again."
      :"Start error: "+e.message);
  }
}

function stopListening(){
  listening=false;

  if(recognition){
    try{recognition.stop()}catch{}
    recognition=null;
  }

  if(stream){
    stream.getTracks().forEach(t=>t.stop());
    stream=null;
  }

  start.disabled=false;
  stop.disabled=true;
}

start.onclick=startListening;
stop.onclick=()=>{
  stopListening();
  setStatus("Stopped.");
};

output.onchange=setOutput;
navigator.mediaDevices.addEventListener?.("devicechange",loadDevices);

(async()=>{await loadDevices()})();