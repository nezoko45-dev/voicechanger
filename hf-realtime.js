const $=id=>document.getElementById(id);
let ws=null,ctx=null,micStream=null,captureNode=null,outputNode=null,outputDest=null,outputAudio=null,running=false;
let inputDevice="",outputDevice="",serverUrl="ws://127.0.0.1:8765/v1/realtime",voice="af_heart";
const TARGET=24000;

function setStatus(s,sub=""){ $("status").textContent=s; $("substatus").textContent=sub; }
function b64(bytes){let s="";const step=0x8000;for(let i=0;i<bytes.length;i+=step)s+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(s)}
function unb64(s){const raw=atob(s),a=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)a[i]=raw.charCodeAt(i);return a}
function int16FromFloat(f){const a=new Int16Array(f.length);for(let i=0;i<f.length;i++){const x=Math.max(-1,Math.min(1,f[i]));a[i]=x<0?x*32768:x*32767}return new Uint8Array(a.buffer)}
function floatFromInt16(u){const v=new Int16Array(u.buffer,u.byteOffset,u.byteLength/2),f=new Float32Array(v.length);for(let i=0;i<v.length;i++)f[i]=v[i]/32768;return f}

async function devices(){
  const before=await navigator.mediaDevices.enumerateDevices();
  if(!before.some(d=>d.kind==="audioinput"&&d.label)){try{const s=await navigator.mediaDevices.getUserMedia({audio:true});s.getTracks().forEach(t=>t.stop())}catch{}}
  const ds=await navigator.mediaDevices.enumerateDevices();
  const ins=ds.filter(d=>d.kind==="audioinput"), outs=ds.filter(d=>d.kind==="audiooutput");
  $("input").innerHTML=ins.map((d,i)=>'<option value="'+d.deviceId+'">'+(d.label||"Microphone "+(i+1))+"</option>").join("");
  $("output").innerHTML=outs.map((d,i)=>'<option value="'+d.deviceId+'">'+(d.label||"Output "+(i+1))+"</option>").join("");
  if(inputDevice)$("input").value=inputDevice;if(outputDevice)$("output").value=outputDevice;
}
function worklet(){
 const code=`
class Mic extends AudioWorkletProcessor{constructor(){super();this.buf=[];this.n=0;this.r=sampleRate/24000}
process(i){const x=i[0]?.[0];if(!x)return true;for(let k=0;k<x.length;k++){this.buf.push(x[k]);this.n++;if(this.n>=Math.round(sampleRate/25)){const out=new Float32Array(Math.max(1,Math.floor(this.buf.length/this.r)));for(let j=0;j<out.length;j++){const p=j*this.r,a=Math.floor(p),b=Math.min(a+1,this.buf.length-1),t=p-a;out[j]=this.buf[a]*(1-t)+this.buf[b]*t}this.buf=[];this.n=0;this.port.postMessage(out)}}return true}}
registerProcessor('hf-mic',Mic);
class Play extends AudioWorkletProcessor{constructor(){super();this.q=[];this.pos=0;this.port.onmessage=e=>{if(e.data.clear){this.q=[];this.pos=0}else if(e.data.audio)this.q.push(e.data.audio)}}process(_,o){const y=o[0]?.[0];if(!y)return true;const ratio=24000/sampleRate;for(let i=0;i<y.length;i++){if(!this.q.length){y[i]=0;continue}const q=this.q[0],p=this.pos,idx=Math.floor(p),t=p-idx;if(idx>=q.length){this.q.shift();this.pos=0;i--;continue}const n=Math.min(idx+1,q.length-1);y[i]=q[idx]*(1-t)+q[n]*t;this.pos+=ratio}return true}}
registerProcessor('hf-play',Play);`;
 const u=URL.createObjectURL(new Blob([code],{type:"application/javascript"}));return u;
}
function sendSession(){
 ws.send(JSON.stringify({type:"session.update",session:{
   type:"realtime",
   instructions:$("instructions").value,
   output_modalities:["audio"],
   audio:{input:{format:{type:"audio/pcm",rate:24000},turn_detection:{type:"server_vad",interrupt_response:true}},output:{format:{type:"audio/pcm",rate:24000},voice:voice}}
 }}));
}
async function start(){
 if(running)return;
 try{
  inputDevice=$("input").value;outputDevice=$("output").value;serverUrl=$("server").value.trim();voice=$("voice").value;
  setStatus("CONNECTING","Local realtime server");
  let connected=false,lastError=null;
  for(let attempt=1;attempt<=120;attempt++){
    try{
      setStatus("STARTING",`Local speech engine loading… ${attempt}/120`);
      ws=new WebSocket(serverUrl);
      await new Promise((res,rej)=>{
        const timer=setTimeout(()=>{try{ws.close()}catch{};rej(new Error("timeout"))},1000);
        ws.onopen=()=>{clearTimeout(timer);res()};
        ws.onerror=()=>{clearTimeout(timer);rej(new Error("connection failed"))};
      });
      connected=true;
      break;
    }catch(e){
      lastError=e;
      ws=null;
      await new Promise(r=>setTimeout(r,1000));
    }
  }
  if(!connected)throw new Error("Local speech backend did not become ready. Make sure the HF Realtime backend window is still running.");
  ws.onmessage=onMessage;ws.onclose=()=>{if(running)stop(false);};
  sendSession();
  ctx=new AudioContext({sampleRate:48000});
  await ctx.audioWorklet.addModule(worklet());
  micStream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:inputDevice?{exact:inputDevice}:undefined,channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  const src=ctx.createMediaStreamSource(micStream);
  captureNode=new AudioWorkletNode(ctx,"hf-mic");
  captureNode.port.onmessage=e=>{if(ws?.readyState===1)ws.send(JSON.stringify({type:"input_audio_buffer.append",audio:b64(int16FromFloat(e.data))}))};
  src.connect(captureNode);
  outputNode=new AudioWorkletNode(ctx,"hf-play");outputNode.connect(ctx.destination);
  if(outputNode.connect&&typeof outputNode.connect==="function"&&ctx.createMediaStreamDestination){try{if("setSinkId" in HTMLMediaElement.prototype){}}catch{}}
  await ctx.resume();running=true;$("orb").className="orb active";setStatus("LISTENING","Speak normally — it will repeat your words");
 }catch(e){console.error(e);setStatus("ERROR",e.message||"Could not start");await stop(false)}
}
function onMessage(e){
 let m;try{m=JSON.parse(e.data)}catch{return}
 if(m.type==="error"){setStatus("ERROR",m.error?.message||"Realtime server error");return}
 if(m.type==="input_audio_buffer.speech_started"){$("orb").className="orb active";setStatus("LISTENING","Hearing you…")}
 if(m.type==="response.created"){$("orb").className="orb thinking";setStatus("THINKING","Local model is preparing the repeat")}
 if(m.type==="response.output_audio.delta"&&outputNode){
  const pcm=floatFromInt16(unb64(m.delta));
  outputNode.port.postMessage({audio:pcm},[pcm.buffer]);
}
 if(m.type==="conversation.item.input_audio_transcription.completed")$("you").textContent=m.transcript||"—";
 if(m.type==="response.output_audio_transcript.delta"){$("agent").textContent+=m.delta||""}
 if(m.type==="response.output_audio_transcript.done"){ $("agent").textContent=m.transcript||$("agent").textContent; }
 if(m.type==="response.done"){$("orb").className="orb active";setStatus("LISTENING","Speak normally — it will repeat your words")}
}
async function stop(close=true){
 running=false;if(captureNode)captureNode.disconnect();if(outputNode)outputNode.disconnect();if(outputAudio){outputAudio.pause();outputAudio.srcObject=null;}if(micStream)micStream.getTracks().forEach(t=>t.stop());if(ctx)await ctx.close().catch(()=>{});if(ws){try{ws.close()}catch{}};ws=null;ctx=null;captureNode=null;outputNode=null;outputDest=null;outputAudio=null;$("orb").className="orb idle";if(close)setStatus("TAP TO START","Local Hugging Face speech-to-speech")
}
$("orb").onclick=()=>running?stop():start();
$("settings").onclick=()=>$("settings-panel").classList.toggle("hidden");
$("save").onclick=()=>{$("settings-panel").classList.add("hidden")};
$("info").onclick=()=>$("about").showModal();
$("voice").onchange=()=>{voice=$("voice").value};
$("output").onchange=async()=>{outputDevice=$("output").value};
navigator.mediaDevices?.addEventListener?.("devicechange",devices);
devices();
