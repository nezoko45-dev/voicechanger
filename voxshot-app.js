import { createRVC, runPipelineInWorker, prepareInputAudio } from "https://esm.sh/rvc-web-runtime@1.0.5";

const $ = (id) => document.getElementById(id);
const status = $("status");
const bar = $("bar");
const player = $("player");
let stream = null;
let audioContext = null;

const CONTENTVEC_URL = "https://huggingface.co/NaruseMioShirakana/MoeSS-SUBModel/resolve/main/vec-768-layer-12.onnx";
const RMVPE_URL = "https://huggingface.co/NaruseMioShirakana/MoeSS-SUBModel/resolve/main/RMVPE.onnx";

function setStatus(s, p=null){
  status.textContent=s;
  if(p!==null) bar.style.width=Math.max(0,Math.min(100,p))+"%";
}
function err(e){ setStatus("Error: "+(e?.message||e),0); console.error(e); }

async function devices(){
  try{
    const temp=await navigator.mediaDevices.getUserMedia({audio:true});
    temp.getTracks().forEach(t=>t.stop());
  }catch{}
  const ds=await navigator.mediaDevices.enumerateDevices();
  const ins=ds.filter(d=>d.kind==="audioinput");
  const outs=ds.filter(d=>d.kind==="audiooutput");
  $("input").innerHTML="";
  $("output").innerHTML="";
  for(const d of ins){
    const o=document.createElement("option");
    o.value=d.deviceId;o.textContent=d.label||"Microphone";
    $("input").appendChild(o);
  }
  for(const d of outs){
    const o=document.createElement("option");
    o.value=d.deviceId;o.textContent=d.label||"Output";
    $("output").appendChild(o);
  }
}
async function getModel(url,name){
  setStatus("Downloading "+name+" model…");
  const r=await fetch(url);
  if(!r.ok) throw new Error(name+" download failed: HTTP "+r.status);
  return new File([await r.blob()],name+".onnx",{type:"application/octet-stream"});
}
async function captureSeconds(seconds=4){
  const deviceId=$("input").value;
  stream=await navigator.mediaDevices.getUserMedia({audio:{
    deviceId:deviceId?{exact:deviceId}:undefined,
    channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false
  }});
  audioContext=new AudioContext();
  const source=audioContext.createMediaStreamSource(stream);
  const dest=audioContext.createMediaStreamDestination();
  source.connect(dest);
  const rec=new MediaRecorder(dest.stream,{mimeType:"audio/webm;codecs=opus"});
  const chunks=[];
  rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  const done=new Promise(resolve=>rec.onstop=resolve);
  rec.start();
  setStatus("Listening… speak now",5);
  await new Promise(r=>setTimeout(r,seconds*1000));
  rec.stop(); await done;
  stream.getTracks().forEach(t=>t.stop()); stream=null;
  const blob=new Blob(chunks,{type:rec.mimeType});
  return new File([blob],"mic.webm",{type:blob.type});
}
async function run(){
  $("start").disabled=true; $("stop").disabled=false;
  try{
    const model=$("model").files?.[0];
    if(!model) throw new Error("Choose an RVC .onnx/.pth voice model first.");
    const [contentVec,rmvpe,audio]=await Promise.all([
      getModel(CONTENTVEC_URL,"ContentVec"),
      getModel(RMVPE_URL,"RMVPE"),
      captureSeconds(4)
    ]);
    setStatus("Decoding microphone audio…",20);
    const decoded=await prepareInputAudio(audio);
    const rvc=createRVC();
    setStatus("Running local RVC…",30);
    const ctx=await runPipelineInWorker(
      rvc,
      {model,contentVec,rmvpe,audio},
      decoded.audio,
      decoded.sampleRate,
      {onEvent(e){
        if(e.type==="stage"){
          const map={input_preparation:10,model_parsing:20,feature_extraction:35,pitch_estimation:50,voice_synthesis:75,post_processing:95,success:100};
          setStatus("RVC: "+e.stage,map[e.stage]??50);
        }else if(e.type==="chunk"){
          setStatus("RVC chunk "+e.current+"/"+e.total,50+(e.current/e.total)*45);
        }
      }},
      {speakerId:0,pitchShift:0,contentVecBackend:"webgpu",rmvpeBackend:"webgpu",chunkDuration:4,padDuration:.5}
    );
    if(ctx.state!=="success"||!ctx.outputWav) throw new Error(ctx.errorMessage||"RVC conversion failed.");
    player.src=URL.createObjectURL(ctx.outputWav);
    try{
      if(player.setSinkId && $("output").value) await player.setSinkId($("output").value);
    }catch(e){console.warn("Output selection unavailable",e)}
    setStatus("Done — converted audio is ready.",100);
  }catch(e){err(e)}
  finally{$("start").disabled=false;$("stop").disabled=true}
}
$("start").onclick=run;
$("stop").onclick=()=>{if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;setStatus("Stopped",0);$("start").disabled=false;$("stop").disabled=true};
navigator.mediaDevices?.addEventListener?.("devicechange",()=>void devices());
void devices();
