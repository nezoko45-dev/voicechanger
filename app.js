const $=id=>document.getElementById(id);
let ws=null,ctx=null,inputStream=null,inputNode=null,processor=null,outputNode=null;
let running=false,devicesLoaded=false;

function status(t,good=false,bad=false){
 const e=$("status"); e.textContent=t; e.className="status"+(good?" good":"")+(bad?" bad":"");
}
function b64(buf){let s="",a=new Uint8Array(buf);for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return btoa(s)}
function fromB64(s){const b=atob(s),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a.buffer}

function pcm16ToFloat(ab){
 const v=new DataView(ab),out=new Float32Array(ab.byteLength/2);
 for(let i=0;i<out.length;i++){const x=v.getInt16(i*2,true);out[i]=x<0?x/32768:x/32767}
 return out;
}

function makeOutputWorklet(){
 const code=`
 class HFOutput extends AudioWorkletProcessor{
   constructor(){super();this.q=[];this.pos=0;this.port.onmessage=e=>{if(e.data.kind==="audio")this.q.push(e.data.samples);if(e.data.kind==="clear"){this.q=[];this.pos=0}}}
   process(ins,outs){
     const o=outs[0][0]; o.fill(0); let p=0;
     while(p<o.length && this.q.length){
       const a=this.q[0], remain=a.length-this.pos, n=Math.min(remain,o.length-p);
       o.set(a.subarray(this.pos,this.pos+n),p);p+=n;this.pos+=n;
       if(this.pos>=a.length){this.q.shift();this.pos=0}
     }
     return true;
   }
 }
 registerProcessor("hf-output",HFOutput);`;
 const blob=new Blob([code],{type:"application/javascript"});
 return ctx.audioWorklet.addModule(URL.createObjectURL(blob));
}

function resampleTo16k(input,rate){
 const ratio=rate/16000,n=Math.max(1,Math.floor(input.length/ratio)),out=new Int16Array(n);
 for(let i=0;i<n;i++){
   const p=i*ratio,j=Math.floor(p),f=p-j;
   const x=input[Math.min(j,input.length-1)]*(1-f)+(input[Math.min(j+1,input.length-1)]||0)*f;
   out[i]=Math.max(-1,Math.min(1,x))*32767;
 }
 return out.buffer;
}

async function loadDevices(){
 const dummy=await navigator.mediaDevices.getUserMedia({audio:true});
 dummy.getTracks().forEach(t=>t.stop());
 const ds=await navigator.mediaDevices.enumerateDevices();
 $("input").innerHTML="";$("output").innerHTML="";
 ds.filter(d=>d.kind==="audioinput").forEach(d=>{
   const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||"Microphone";$("input").appendChild(o)
 });
 ds.filter(d=>d.kind==="audiooutput").forEach(d=>{
   const o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||"Speaker / Voicemeeter";$("output").appendChild(o)
 });
 devicesLoaded=true;
}

async function start(){
 if(running)return;
 try{
  if(!devicesLoaded)await loadDevices();
  const inId=$("input").value,outId=$("output").value;
  inputStream=await navigator.mediaDevices.getUserMedia({audio:{
    deviceId:inId?{exact:inId}:undefined,channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false
  }});
  ctx=new AudioContext();
  await ctx.resume();
  await makeOutputWorklet();
  outputNode=new AudioWorkletNode(ctx,"hf-output");
  if("setSinkId" in ctx && outId){try{await ctx.setSinkId(outId)}catch(e){}}
  outputNode.connect(ctx.destination);

  const src=ctx.createMediaStreamSource(inputStream);
  processor=ctx.createScriptProcessor(4096,1,1);
  processor.onaudioprocess=e=>{
    if(!ws||ws.readyState!==WebSocket.OPEN)return;
    const pcm=resampleTo16k(e.inputBuffer.getChannelData(0),ctx.sampleRate);
    ws.send(JSON.stringify({type:"input_audio_buffer.append",audio:b64(pcm)}));
  };
  src.connect(processor);processor.connect(ctx.destination);

  ws=new WebSocket("ws://127.0.0.1:8766/v1/realtime");
  ws.onopen=()=>{
    ws.send(JSON.stringify({type:"session.update",session:{
      type:"realtime",
      instructions:"REPEAT-ONLY MODE. When the user speaks, repeat exactly the words you heard. Do not answer the user. Do not greet them. Do not ask questions. Do not add, remove, explain, summarize, or paraphrase. Your response must contain only the user's spoken words, reproduced as faithfully as possible.",
      audio:{input:{turn_detection:{type:"server_vad",interrupt_response:true}},output:{voice:$("voice").value}},
      output_modalities:["audio"]
    }}));
    running=true;status("Connected • listening",true);
  };
  ws.onmessage=ev=>{
    let e;try{e=JSON.parse(ev.data)}catch{return}
    if(e.type==="error"){status(e.error?.message||"Backend error",false,true);return}
    if(e.type==="conversation.item.input_audio_transcription.completed"){
      $("heard").textContent="Heard: "+(e.transcript||"");
    }
    if(e.type==="response.output_audio.delta"||e.type==="response.audio.delta"){
      if(outputNode&&e.delta){
        outputNode.port.postMessage({kind:"audio",samples:pcm16ToFloat(fromB64(e.delta))});
      }
    }
    if(e.type==="input_audio_buffer.speech_started") status("Listening…",true);
    if(e.type==="input_audio_buffer.speech_stopped") status("Repeating…",true);
  };
  ws.onerror=()=>status("WebSocket error — is the local HF backend ready?",false,true);
  ws.onclose=()=>{if(running){running=false;status("Disconnected",false,true)}};
 }catch(e){status(e.message||String(e),false,true);stop()}
}

function stop(){
 running=false;
 try{processor?.disconnect()}catch{} try{inputNode?.disconnect()}catch{}
 try{outputNode?.port.postMessage({kind:"clear"});outputNode?.disconnect()}catch{}
 try{inputStream?.getTracks().forEach(t=>t.stop())}catch{}
 try{ws?.close()}catch{}
 try{ctx?.close()}catch{}
 ws=null;processor=null;outputNode=null;inputStream=null;ctx=null;
 status("Stopped.",true);
}

$("start").onclick=start;$("stop").onclick=stop;
$("voice").onchange=()=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:"session.update",session:{audio:{output:{voice:$("voice").value}}}))};
navigator.mediaDevices.addEventListener?.("devicechange",()=>loadDevices().catch(()=>{}));
loadDevices().then(()=>status("Ready — press Start.",true)).catch(e=>status("Microphone permission is required.",false,true));