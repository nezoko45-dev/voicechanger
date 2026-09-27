const $=id=>document.getElementById(id);
const mic=$("mic"),output=$("output"),micTest=$("micTest"),stopMic=$("stopMic");
const generate=$("generate"),text=$("text"),status=$("status"),player=$("player");
let micStream=null,micContext=null,micSource=null;

function setStatus(v){status.textContent=v;}

async function loadDevices(){
  const devices=await navigator.mediaDevices.enumerateDevices();
  mic.innerHTML="";
  output.innerHTML="";
  const inputs=devices.filter(d=>d.kind==="audioinput");
  const outputs=devices.filter(d=>d.kind==="audiooutput");
  inputs.forEach((d,i)=>{
    const o=document.createElement("option");
    o.value=d.deviceId;o.textContent=d.label||`Microphone ${i+1}`;mic.appendChild(o);
  });
  outputs.forEach((d,i)=>{
    const o=document.createElement("option");
    o.value=d.deviceId;o.textContent=d.label||`Output ${i+1}`;output.appendChild(o);
  });
  if(!inputs.length)mic.innerHTML="<option value=''>Default microphone</option>";
  if(!outputs.length)output.innerHTML="<option value=''>Default output</option>";
}

async function check(){
  try{
    const r=await fetch("/health",{cache:"no-store"});
    const j=await r.json();
    setStatus(j.ok?"PocketTTS ready — enter text and generate.":j.error||"PocketTTS is starting…");
  }catch{
    setStatus("Open the local PocketTTS app through its local server.");
  }
}
navigator.mediaDevices.addEventListener?.("devicechange",loadDevices);

micTest.onclick=async()=>{
  try{
    stopMic.click();
    await navigator.mediaDevices.getUserMedia({audio:true});
    await loadDevices();
    micStream=await navigator.mediaDevices.getUserMedia({
      audio:{deviceId:mic.value?{exact:mic.value}:undefined,
      channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}
    });
    micContext=new AudioContext();
    micSource=micContext.createMediaStreamSource(micStream);
    const gain=micContext.createGain();gain.gain.value=.18;
    micSource.connect(gain).connect(micContext.destination);
    micTest.disabled=true;stopMic.disabled=false;
    setStatus("Microphone test running.");
  }catch(e){setStatus("Microphone error: "+e.message);}
};

stopMic.onclick=()=>{
  if(micSource){try{micSource.disconnect()}catch{}micSource=null}
  if(micContext){try{micContext.close()}catch{}micContext=null}
  if(micStream){micStream.getTracks().forEach(t=>t.stop());micStream=null}
  micTest.disabled=false;stopMic.disabled=true;
  setStatus("Microphone test stopped.");
};

output.onchange=async()=>{
  if(typeof player.setSinkId==="function"&&output.value){
    try{await player.setSinkId(output.value)}catch(e){console.warn(e)}
  }
};

generate.onclick=async()=>{
  const value=text.value.trim();
  if(!value)return setStatus("Enter some text first.");
  generate.disabled=true;
  setStatus("Generating with local PocketTTS…");
  try{
    const r=await fetch("/tts",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({text:value})
    });
    if(!r.ok)throw new Error(await r.text());
    const blob=await r.blob();
    const old=player.src;
    player.src=URL.createObjectURL(blob);
    if(old)URL.revokeObjectURL(old);
    if(typeof player.setSinkId==="function"&&output.value)await player.setSinkId(output.value);
    await player.play();
    setStatus("Done — local PocketTTS voice is playing.");
  }catch(e){setStatus("PocketTTS error: "+e.message)}
  finally{generate.disabled=false}
};

(async()=>{try{await navigator.mediaDevices.getUserMedia({audio:true})}catch{}await loadDevices();await check()})();
