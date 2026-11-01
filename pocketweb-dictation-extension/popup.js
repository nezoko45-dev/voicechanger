const statusEl=document.getElementById("status");
async function send(action){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id||!tab.url?.startsWith("https://pocketweb.tools/voice-cloning")){
    statusEl.textContent="Open https://pocketweb.tools/voice-cloning in this tab first.";return;
  }
  try{
    const response=await chrome.tabs.sendMessage(tab.id,{action});
    statusEl.textContent=response?.status||"Command sent.";
  }catch(e){statusEl.textContent="Reload the PocketWebTools tab after installing the extension, then try again.";}
}
document.getElementById("start").addEventListener("click",()=>send("start"));
document.getElementById("stop").addEventListener("click",()=>send("stop"));
async function refresh(){
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 if(tab?.id)try{const r=await chrome.tabs.sendMessage(tab.id,{action:"status"});if(r?.status)statusEl.textContent=r.status;}catch{}
}
refresh();