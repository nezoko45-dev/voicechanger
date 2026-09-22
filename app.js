const $=id=>document.getElementById(id),mic=$("mic"),out=$("out"),voice=$("voice"),load=$("load"),start=$("start"),stop=$("stop"),cable=$("cable"),status=$("status"),msg=$("msg");
let ws,running=false,cableId=null;
const say=x=>msg.textContent=x;
async function health(){try{const j=await fetch("/health").then(r=>r.json());status.textContent=j.voice?"Backend online • Voice loaded • WASAPI":j.models?"Backend online • Models ready • WASAPI":"Backend online • Load a voice";return j}catch{status.textContent="Backend offline";return null}}
function addDevice(select,d,labelExtra=""){const o=document.createElement("option");o.value=d.id;o.dataset.name=d.name||"";o.textContent=(d.name||"Audio device")+labelExtra;select.appendChild(o)}
async function devices(){
  try{
    const j=await fetch("/devices").then(r=>r.json());if(!j.ok)throw Error(j.error);
    const keepMic=mic.value,keepOut=out.value;mic.innerHTML="";out.innerHTML="";cableId=null;
    for(const d of j.devices){
      const isCable=String(d.name||"").toLowerCase().includes("cable input")&&String(d.name||"").toLowerCase().includes("vb-audio");
      let label=d.name||"Audio device";
      if(d.inputChannels>0)label+=" [input "+d.inputChannels+"]";
      if(d.outputChannels>0)label+=" [output "+d.outputChannels+"]";
      if(isCable){label+=" • VB-CABLE";cableId=String(d.id)}
      if(d.inputChannels>0)addDevice(mic,d,label.replace(/ \[output \d+\]/,""));
      if(d.outputChannels>0)addDevice(out,d,label);
    }
    if([...mic.options].some(x=>x.value===keepMic))mic.value=keepMic;
    if([...out.options].some(x=>x.value===keepOut))out.value=keepOut;
    if(cableId!==null) out.value=cableId;
    cable.disabled=cableId===null;
    cable.textContent=cableId===null?"VB-CABLE not detected":"Use VB-CABLE";
    if(cableId===null)say("WASAPI ready. Install VB-CABLE to send audio directly to VRChat/Discord.");
  }catch(e){say("WASAPI device error: "+e.message)}
}
function useCable(){if(cableId===null){say("VB-CABLE was not detected. Install the VB-CABLE driver, then Refresh devices.");return}out.value=cableId;say("VB-CABLE selected. VRChat/Discord should use CABLE Output as its microphone.");}
function connect(){return new Promise((resolve,reject)=>{ws=new WebSocket("ws://127.0.0.1:8765/audio");ws.onopen=resolve;ws.onerror=()=>reject(Error("WASAPI WebSocket connection failed."));ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==="status")say(m.text);if(m.type==="error")say("Backend: "+m.error)};ws.onclose=()=>{running=false;start.disabled=false;stop.disabled=true}})}
load.onclick=async()=>{const f=voice.files[0];if(!f){say("Choose a WAV first.");return}load.disabled=true;say("Loading voice...");try{const b=new Uint8Array(await f.arrayBuffer());let s="";for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));const r=await fetch("/target",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({wav:btoa(s)})});const j=await r.json();if(!j.ok)throw Error(j.error);say("Voice loaded. Choose your output device.");await health()}catch(e){say("Voice load failed: "+e.message)}finally{load.disabled=false}};
start.onclick=async()=>{if(running)return;try{const h=await health();if(!h?.voice){say("Load a reference WAV first.");return}if(!mic.value){say("Choose a microphone.");return}if(!out.value){say("Choose an output device.");return}await connect();ws.send(JSON.stringify({type:"start",inputId:mic.value,inputName:mic.options[mic.selectedIndex]?.dataset.name||"",outputId:out.value}));running=true;start.disabled=true;stop.disabled=false;say(String(out.options[out.selectedIndex]?.textContent||"Output")+" selected. Starting...")}catch(e){say("Start failed: "+e.message);try{ws?.close()}catch{}}};
stop.onclick=()=>{try{ws?.send(JSON.stringify({type:"stop"}));ws?.close()}catch{}running=false;start.disabled=false;stop.disabled=true;say("Stopped.")};
cable.onclick=useCable;
$("refresh").onclick=devices;
(async()=>{await health();await devices()})();
