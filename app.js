const $=id=>document.getElementById(id);
const mic=$("mic"),out=$("out"),voice=$("voice"),load=$("load"),start=$("start"),stop=$("stop");
const vm=$("cable"),refresh=$("refresh"),status=$("status"),msg=$("msg");
let running=false,voiceLoaded=false,voicemeeterId=null;

const say=x=>msg.textContent=x;
const setStatus=x=>status.innerHTML='<span class="dot"></span>'+x;

async function health(){
  try{
    const j=await fetch("/health",{cache:"no-store"}).then(r=>r.json());
    setStatus(j.running?"VoiceChanger running • Mic → OpenVoice → Voicemeeter":j.voice?"Ready • Voice loaded":"Ready • Load a voice");
    return j;
  }catch{setStatus("Backend offline");return null}
}
function add(select,d,label){
  const o=document.createElement("option");
  o.value=String(d.id);o.dataset.name=d.name||"";o.textContent=label||d.name||"Audio device";
  select.appendChild(o);
}
async function devices(){
  try{
    const j=await fetch("/devices",{cache:"no-store"}).then(r=>r.json());
    if(!j.ok)throw Error(j.error);
    const oldMic=mic.value,oldOut=out.value;
    mic.innerHTML="";out.innerHTML="";voicemeeterId=j.voicemeeterId??null;
    for(const d of j.devices){
      const name=String(d.name||"Audio device");
      if(d.inputChannels>0)add(mic,d,name+" [mic]");
      if(d.outputChannels>0)add(out,d,name+" [output]");
    }
    if([...mic.options].some(x=>x.value===oldMic))mic.value=oldMic;
    if([...out.options].some(x=>x.value===oldOut))out.value=oldOut;
    if(voicemeeterId!==null)out.value=String(voicemeeterId);
    vm.disabled=voicemeeterId===null;
    vm.textContent=voicemeeterId===null?"Voicemeeter not detected":"Use Voicemeeter";
    say(voicemeeterId===null?"Choose your output device.":"Voicemeeter detected and selected.");
  }catch(e){say("Audio device error: "+e.message)}
}
async function loadVoice(){
  const f=voice.files[0];
  if(!f){say("Choose a reference WAV first.");return}
  load.disabled=true;say("Loading OpenVoice reference...");
  try{
    const b=new Uint8Array(await f.arrayBuffer());let s="";
    for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));
    const r=await fetch("/target",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wav:btoa(s)})});
    const j=await r.json();if(!j.ok)throw Error(j.error);
    voiceLoaded=true;say("OpenVoice reference loaded.");await health();
  }catch(e){say("Voice load failed: "+e.message)}
  finally{load.disabled=false}
}
async function startAudio(){
  if(running)return;
  try{
    const h=await health();
    if(!voiceLoaded&&!h?.voice){say("Load a reference WAV first.");return}
    if(!mic.value){say("Choose your microphone.");return}
    if(!out.value){say("Choose Voicemeeter as the output.");return}
    start.disabled=true;stop.disabled=true;say("Starting mic → OpenVoice → Voicemeeter...");
    const r=await fetch("/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({inputId:Number(mic.value),outputId:Number(out.value)})});
    const j=await r.json();if(!j.ok)throw Error(j.error);
    running=true;stop.disabled=false;setStatus("Running • microphone → OpenVoice V2 ONNX → Voicemeeter");
    say("Live voice conversion is running.");
  }catch(e){
    running=false;start.disabled=false;stop.disabled=true;say("Start failed: "+e.message);await health();
  }
}
async function stopAudio(){
  try{await fetch("/stop",{method:"POST"})}catch{}
  running=false;start.disabled=false;stop.disabled=true;say("Stopped.");await health();
}
load.onclick=loadVoice;
start.onclick=startAudio;
stop.onclick=stopAudio;
vm.onclick=()=>{
  if(voicemeeterId===null){say("Voicemeeter was not detected.");return}
  out.value=String(voicemeeterId);say("Voicemeeter selected as output.");
};
refresh.onclick=async()=>{await health();await devices()};
setInterval(async()=>{
  if(running){
    const h=await health();
    if(!h?.running){running=false;start.disabled=false;stop.disabled=true;say("Audio stopped.");}
  }
},1500);
(async()=>{await health();await devices()})();
