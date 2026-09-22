let running=false;
let ctx=null;
let stream=null;
let source=null;
let processor=null;
let stt=null;
let tts=null;
let sttKeepAlive=null;
let playAt=0;
let ttsPending=0;

const $=id=>document.getElementById(id);

function status(message,kind=""){
  const el=$("status");
  if(!el)return;
  el.textContent=message;
  el.className="status "+kind;
}

function protocols(token){
  return ["token",token];
}

function downsampleTo16k(input,inRate){
  const ratio=inRate/16000;
  const length=Math.floor(input.length/ratio);
  const out=new Int16Array(length);

  for(let i=0;i<length;i++){
    const p=i*ratio;
    const a=Math.floor(p);
    const b=Math.min(a+1,input.length-1);
    const frac=p-a;
    const sample=(input[a]||0)+((input[b]||input[a]||0)-(input[a]||0))*frac;
    out[i]=Math.max(-32768,Math.min(32767,Math.round(sample*32767)));
  }
  return out.buffer;
}

function pcm16ToFloat32(buffer){
  const pcm=new Int16Array(buffer);
  const out=new Float32Array(pcm.length);
  for(let i=0;i<pcm.length;i++)out[i]=pcm[i]/32768;
  return out;
}

function playPCM(buffer,sampleRate=24000){
  if(!ctx||!running)return;
  const samples=pcm16ToFloat32(buffer);
  if(!samples.length)return;

  const audio=ctx.createBuffer(1,samples.length,sampleRate);
  audio.copyToChannel(samples,0);

  const node=ctx.createBufferSource();
  node.buffer=audio;
  node.connect(ctx.destination);

  const now=ctx.currentTime;
  if(playAt<now+0.01)playAt=now+0.01;
  node.start(playAt);
  playAt+=audio.duration;
  ttsPending=Math.max(0,ttsPending+audio.duration);
  node.onended=()=>{ttsPending=Math.max(0,ttsPending-audio.duration)};
}

function makeAudioProcessor(){
  // 4096 samples at 48 kHz is ~85 ms: close to Flux's recommended small streaming chunks.
  const p=ctx.createScriptProcessor(4096,1,1);

  p.onaudioprocess=e=>{
    if(!running||!stt||stt.readyState!==WebSocket.OPEN)return;
    const pcm=downsampleTo16k(e.inputBuffer.getChannelData(0),ctx.sampleRate);
    if(pcm.byteLength)stt.send(pcm);
  };

  const mute=ctx.createGain();
  mute.gain.value=0;
  source.connect(p);
  p.connect(mute);
  mute.connect(ctx.destination);
  return p;
}

function connectFluxSTT(token){
  return new Promise((resolve,reject)=>{
    const params=new URLSearchParams({
      model:"flux-general-en",
      encoding:"linear16",
      sample_rate:"16000",
      eot_threshold:"0.70",
      eot_timeout_ms:"5000"
    });

    stt=new WebSocket(
      "wss://api.deepgram.com/v2/listen?"+params.toString(),
      protocols(token)
    );
    stt.binaryType="arraybuffer";

    stt.onopen=()=>{
      status("Flux STT connected. Continuous microphone streaming is ON.","ok");
      resolve();
    };

    stt.onmessage=e=>{
      let msg;
      try{msg=JSON.parse(e.data)}catch{return}

      if(msg.type==="TurnInfo"){
        const text=String(msg.transcript||"").trim();
        if(text){
          $("transcript").textContent=text;
          sendToAmalthea(text);
        }
        return;
      }

      if(msg.type==="Error"){
        status("Flux STT error: "+(msg.description||"Unknown error"),"err");
      }
    };

    stt.onerror=()=>{
      reject(new Error("Flux STT WebSocket error. Check the Deepgram key/token."));
    };

    stt.onclose=()=>{
      if(running)status("Flux STT disconnected.","err");
    };
  });
}

function connectAmalthea(token){
  return new Promise((resolve,reject)=>{
    const params=new URLSearchParams({
      model:"aura-2-amalthea-en",
      encoding:"linear16",
      sample_rate:"24000"
    });

    tts=new WebSocket(
      "wss://api.deepgram.com/v1/speak?"+params.toString(),
      protocols(token)
    );
    tts.binaryType="arraybuffer";

    tts.onopen=()=>{
      status("Flux STT + Amalthea TTS connected. Speak normally.","ok");
      resolve();
    };

    tts.onmessage=e=>{
      if(typeof e.data==="string"){
        try{
          const msg=JSON.parse(e.data);
          if(msg.type==="Error"||msg.type==="Warning"){
            status("Amalthea TTS: "+(msg.description||msg.message||"Unknown response"),"err");
          }
        }catch{}
        return;
      }

      if(e.data instanceof ArrayBuffer){
        playPCM(e.data,24000);
      }else if(e.data?.arrayBuffer){
        e.data.arrayBuffer().then(b=>playPCM(b,24000));
      }
    };

    tts.onerror=()=>{
      reject(new Error("Amalthea TTS WebSocket error."));
    };

    tts.onclose=()=>{
      if(running)status("Amalthea TTS disconnected.","err");
    };
  });
}

function sendToAmalthea(text){
  if(!tts||tts.readyState!==WebSocket.OPEN)return;

  // One persistent TTS socket; each transcript is one turn.
  tts.send(JSON.stringify({type:"Speak",text}));
  tts.send(JSON.stringify({type:"Flush"}));
}

async function start(){
  if(running)return;

  const token=$("key").value.trim();
  if(!token){
    status("Paste your Deepgram API key or temporary token first.","err");
    $("key").focus();
    return;
  }

  $("start").disabled=true;
  $("stop").disabled=false;
  running=true;
  playAt=0;
  ttsPending=0;

  try{
    ctx=new AudioContext({latencyHint:"interactive"});
    await ctx.resume();

    stream=await navigator.mediaDevices.getUserMedia({
      audio:{
        channelCount:1,
        echoCancellation:false,
        noiseSuppression:false,
        autoGainControl:false
      }
    });

    source=ctx.createMediaStreamSource(stream);

    // Open both persistent sockets before the microphone starts sending audio.
    await connectFluxSTT(token);
    await connectAmalthea(token);

    processor=makeAudioProcessor();

    // Flux v2 needs activity during silence; keep the session alive.
    sttKeepAlive=setInterval(()=>{
      if(stt?.readyState===WebSocket.OPEN){
        stt.send(JSON.stringify({type:"KeepAlive"}));
      }
    },5000);

    status("RUNNING — continuous Flux STT + Amalthea Filipino TTS.","ok");
  }catch(error){
    const message=error?.message||String(error);
    stop(false);
    status("Start error: "+message,"err");
  }
}

function stop(showStatus=true){
  running=false;

  if(sttKeepAlive)clearInterval(sttKeepAlive);
  sttKeepAlive=null;

  try{
    if(stt?.readyState===WebSocket.OPEN)
      stt.send(JSON.stringify({type:"CloseStream"}));
  }catch{}

  try{
    if(tts?.readyState===WebSocket.OPEN)
      tts.send(JSON.stringify({type:"Close"}));
  }catch{}

  try{processor?.disconnect()}catch{}
  try{source?.disconnect()}catch{}
  try{stream?.getTracks().forEach(t=>t.stop())}catch{}
  try{ctx?.close()}catch{}

  stt=null;
  tts=null;
  processor=null;
  source=null;
  stream=null;
  ctx=null;
  playAt=0;
  ttsPending=0;

  $("stop").disabled=true;
  $("start").disabled=false;

  if(showStatus)status("Stopped.");
}

function init(){
  $("start").disabled=false;
  $("stop").disabled=true;
  $("start").addEventListener("click",start);
  $("stop").addEventListener("click",()=>stop(true));
  status("Ready. Paste your Deepgram key/token, then press Start listening.");
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",init);
}else{
  init();
}

window.addEventListener("beforeunload",()=>stop(false));