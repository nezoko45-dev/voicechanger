const status=document.getElementById("status");
const WS_URL="ws://127.0.0.1:8765/source";
const RATE=48000,CHUNK=960;
let ws=null,stream=null,ctx=null,source=null,worklet=null,running=false;
const setStatus=text=>status.textContent=text;
const sendJson=value=>{if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(value))};
function chooseDevice(devices,name){
 const lower=String(name||"").toLowerCase();
 return devices.find(d=>d.kind==="audioinput"&&d.label===name)
  ||devices.find(d=>d.kind==="audioinput"&&d.label.toLowerCase()===lower)
  ||devices.find(d=>d.kind==="audioinput"&&d.label.toLowerCase().includes(lower))
  ||devices.find(d=>d.kind==="audioinput");
}
async function makeWorklet(){
 const code=[
 "class CaptureProcessor extends AudioWorkletProcessor{",
 "constructor(){super();this.buf=new Float32Array("+CHUNK+");this.used=0}",
 "process(inputs){",
 "const input=inputs[0]&&inputs[0][0];if(!input)return true;let p=0;",
 "while(p<input.length){const n=Math.min(input.length-p,this.buf.length-this.used);",
 "this.buf.set(input.subarray(p,p+n),this.used);this.used+=n;p+=n;",
 "if(this.used===this.buf.length){this.port.postMessage(this.buf.slice(0));this.used=0}}",
 "return true}",
 "}",
 "registerProcessor('voicechanger-capture',CaptureProcessor);"
 ].join("\n");
 const url=URL.createObjectURL(new Blob([code],{type:"application/javascript"}));
 await ctx.audioWorklet.addModule(url);URL.revokeObjectURL(url);
}
function floatToPcm16(x){
 const out=new ArrayBuffer(x.length*2),view=new DataView(out);
 for(let i=0;i<x.length;i++){const v=Math.max(-1,Math.min(1,x[i]));view.setInt16(i*2,v<0?v*32768:v*32767,true)}
 return out;
}
async function stopCapture(){
 running=false;try{worklet?.disconnect()}catch{}try{source?.disconnect()}catch{}
 try{await ctx?.close()}catch{}stream?.getTracks().forEach(t=>t.stop());
 worklet=null;source=null;ctx=null;stream=null;
}
async function startCapture(deviceName){
 await stopCapture();
 const devices=await navigator.mediaDevices.enumerateDevices(),chosen=chooseDevice(devices,deviceName);
 if(!chosen)throw Error("No Electron microphone was found.");
 stream=await navigator.mediaDevices.getUserMedia({audio:{
  deviceId:{exact:chosen.deviceId},channelCount:{ideal:1,max:1},sampleRate:{ideal:RATE},
  sampleSize:{ideal:16},echoCancellation:false,noiseSuppression:false,autoGainControl:false
 },video:false});
 ctx=new AudioContext({sampleRate:RATE,latencyHint:"interactive"});await ctx.resume();await makeWorklet();
 source=ctx.createMediaStreamSource(stream);
 worklet=new AudioWorkletNode(ctx,"voicechanger-capture",{numberOfInputs:1,numberOfOutputs:0});
 worklet.port.onmessage=e=>{if(running&&ws?.readyState===WebSocket.OPEN)ws.send(floatToPcm16(e.data))};
 source.connect(worklet);running=true;
 setStatus("Electron microphone active: "+(chosen.label||deviceName||"default"));
 sendJson({type:"ready",deviceName:chosen.label||deviceName});
}
function connect(){
 ws=new WebSocket(WS_URL);ws.binaryType="arraybuffer";
 ws.onopen=()=>{setStatus("Electron source connected. Waiting for Chrome controller...");sendJson({type:"hello"})};
 ws.onmessage=async e=>{try{const m=JSON.parse(e.data);
  if(m.type==="start")await startCapture(m.deviceName);
  else if(m.type==="stop"){await stopCapture();setStatus("Electron source stopped.")}
 }catch(err){setStatus("Electron audio error: "+err.message);sendJson({type:"error",error:err.message})}};
 ws.onclose=()=>{void stopCapture();setStatus("Backend disconnected. Retrying...");setTimeout(connect,1000)};
 ws.onerror=()=>{};
}
connect();
