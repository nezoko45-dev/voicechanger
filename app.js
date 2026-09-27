const $ = id => document.getElementById(id);
const mic = $("mic"), output = $("output"), start = $("start"), stop = $("stop");
const statusEl = $("status"), heard = $("heard");
let stream, ctx, source, worklet, ws, audio = new Audio();
let running = false;

function status(s){ statusEl.textContent = s; }

async function devices(){
  const list = await navigator.mediaDevices.enumerateDevices();
  mic.innerHTML = "";
  output.innerHTML = "";
  list.filter(d=>d.kind==="audioinput").forEach((d,i)=>{
    const o=document.createElement("option"); o.value=d.deviceId; o.textContent=d.label||`Microphone ${i+1}`; mic.appendChild(o);
  });
  list.filter(d=>d.kind==="audiooutput").forEach((d,i)=>{
    const o=document.createElement("option"); o.value=d.deviceId; o.textContent=d.label||`Output ${i+1}`; output.appendChild(o);
  });
  if(!mic.options.length) mic.innerHTML="<option value=''>Default microphone</option>";
  if(!output.options.length) output.innerHTML="<option value=''>Default output</option>";
}

async function check(){
  try {
    const r=await fetch("/health"); const j=await r.json();
    status(j.ok ? "Local engine ready. Click START." : "Local engine needs setup.");
  } catch { status("Local server is not running. Use start_local.bat."); }
}
navigator.mediaDevices.addEventListener?.("devicechange", devices);
check(); devices();

output.addEventListener("change", async()=>{
  if(typeof audio.setSinkId==="function"){
    try { await audio.setSinkId(output.value); } catch(e) { console.warn(e); }
  }
});

start.onclick = async()=>{
  if(running) return;
  try {
    running=true; start.disabled=true; stop.disabled=false; status("Opening microphone…");
    await navigator.mediaDevices.getUserMedia({audio:true});
    await devices();

    const constraints={audio:{
      deviceId: mic.value ? {exact:mic.value}:undefined,
      channelCount:1, echoCancellation:false, noiseSuppression:false, autoGainControl:false
    }};
    stream=await navigator.mediaDevices.getUserMedia(constraints);

    ctx=new AudioContext();
    await ctx.audioWorklet.addModule("capture-worklet.js");
    source=ctx.createMediaStreamSource(stream);
    worklet=new AudioWorkletNode(ctx,"downsampler",{processorOptions:{targetRate:16000}});
    worklet.port.onmessage=e=>{
      if(ws?.readyState===WebSocket.OPEN) ws.send(e.data.buffer);
    };
    source.connect(worklet);
    worklet.connect(ctx.destination);

    ws=new WebSocket((location.protocol==="https:"?"wss://":"ws://")+location.host+"/audio");
    ws.binaryType="arraybuffer";
    ws.onopen=()=>{ status("Listening locally… speak normally."); };
    ws.onmessage=async e=>{
      const m=JSON.parse(e.data);
      if(m.type==="partial"){ heard.textContent=m.text||"—"; }
      if(m.type==="final" && m.text){
        heard.textContent=m.text;
        status("Generating local cloned voice…");
        try{
          const r=await fetch("/tts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:m.text})});
          if(!r.ok) throw new Error(await r.text());
          const blob=await r.blob();
          audio.src=URL.createObjectURL(blob);
          if(typeof audio.setSinkId==="function" && output.value) await audio.setSinkId(output.value);
          await audio.play();
          status("Listening locally…");
        }catch(err){ status("TTS error: "+err.message); }
      }
      if(m.type==="error") status(m.message);
    };
    ws.onerror=()=>status("Local audio connection failed.");
  } catch(e){
    status("Start error: "+e.message);
    stopApp();
  }
};

function stopApp(){
  running=false; start.disabled=false; stop.disabled=true;
  if(ws){try{ws.close()}catch{} ws=null}
  if(source){try{source.disconnect()}catch{} source=null}
  if(worklet){try{worklet.disconnect()}catch{} worklet=null}
  if(ctx){try{ctx.close()}catch{} ctx=null}
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
}
stop.onclick=()=>{stopApp();status("Stopped.");};