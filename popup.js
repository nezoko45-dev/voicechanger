(() => {
 const autoButton=document.querySelector("#auto"),monitorButton=document.querySelector("#monitor"),status=document.querySelector("#status");
 let auto=false,monitor=false;
 function render(message){
  autoButton.textContent=auto?"■ Stop auto-clicking":"▶ Start auto-clicking Call again";
  autoButton.classList.toggle("stop",auto);
  monitorButton.textContent=monitor?"■ Stop local mismatch monitor":"🎙 Start local mismatch monitor";
  monitorButton.classList.toggle("stop",monitor);
  if(message)status.textContent=message;
 }
 async function activeFishTab(){
  const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});
  return tabs[0];
 }
 async function send(type,extra={}){
  const b=type.includes("AUDIO")?monitorButton:autoButton;b.disabled=true;
  try{
   const result=await chrome.runtime.sendMessage({type,...extra});
   if(!result?.ok)status.textContent=result?.message||result?.error||"Action failed.";
   else {
    if(type==="FISH_AUDIO_AUTO_TOGGLE")auto=!!result.automatic;
    if(type==="FISH_AUDIO_AUDIO_START")monitor=true;
    if(type==="FISH_AUDIO_AUDIO_STOP")monitor=false;
    render(result.message||"Ready.");
   }
  }catch(e){status.textContent="Action failed: "+(e?.message||String(e));}
  finally{b.disabled=false;}
 }
 autoButton.addEventListener("click",()=>send("FISH_AUDIO_AUTO_TOGGLE"));
 monitorButton.addEventListener("click",async()=>{
  const tab=await activeFishTab();
  if(!tab?.id){status.textContent="Open Fish Audio first.";return;}
  if(monitor)await send("FISH_AUDIO_AUDIO_STOP");
  else await send("FISH_AUDIO_AUDIO_START",{tabId:tab.id});
 });
 chrome.runtime.onMessage.addListener(message=>{
  if(message?.type==="FISH_AUDIO_STATUS_UPDATE"){
   if(typeof message.automatic==="boolean")auto=message.automatic;
   if(message.status==="monitoring")monitor=true;
   render(message.message||message.detail|| (message.status==="mismatch"?"Transcript mismatch detected.":message.status==="match"?"Transcript match.":""));
  }
 });
 (async()=>{
  try{
   const result=await chrome.runtime.sendMessage({type:"FISH_AUDIO_GET_STATUS"});
   if(result?.ok){auto=!!result.automatic;render(result.message);}
   const saved=await chrome.storage.local.get({fishAudioCompareEnabled:false});
   monitor=!!saved.fishAudioCompareEnabled;render();
  }catch{}
 })();
})();
