const $=id=>document.getElementById(id);
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{"Content-Type":"application/json",...(opts.headers||{})}});const j=await r.json();if(!r.ok||j.ok===false)throw Error(j.error||"Request failed");return j}
function setStatus(s,ok=false,err=false){$("status").textContent=s;$("status").className="status"+(ok?" ok":"")+(err?" err":"")}
async function refresh(){
  try{
    const d=await api("/devices");
    const ins=d.devices.filter(x=>x.input),outs=d.devices.filter(x=>x.output);
    $("input").innerHTML=ins.map(x=>`<option value="${x.id}">${x.name}</option>`).join("");
    $("output").innerHTML=outs.map(x=>`<option value="${x.id}" ${x.id===d.voicemeeterId?"selected":""}>${x.name}</option>`).join("");
    setStatus("Ready",true);
  }catch(e){setStatus(e.message,true,true)}
}
$("voice").onchange=async()=>{
  const f=$("voice").files[0];if(!f)return;
  try{
    const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f)});
    await api("/target",{method:"POST",body:JSON.stringify({wav:b64})});
    setStatus("Voice loaded: "+f.name,true);
  }catch(e){setStatus(e.message,false,true)}
};
$("start").onclick=async()=>{
  try{await api("/start",{method:"POST",body:JSON.stringify({inputId:Number($("input").value),outputId:Number($("output").value)})});setStatus("RUNNING — audio is now EXE → Voicemeeter",true)}catch(e){setStatus(e.message,false,true)}
};
$("stop").onclick=async()=>{try{await api("/stop",{method:"POST"});setStatus("Stopped")}catch(e){setStatus(e.message,false,true)}};
async function status(){try{const s=await api("/health");$("details").textContent=JSON.stringify(s,null,2)}catch{}}
refresh();setInterval(status,1000);
