const statusEl=document.getElementById("status");
async function send(action){
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id||!/^https:\/\/(www\.)?dopple\.ai\//.test(tab.url||"")){statusEl.textContent="Open a Dopple.ai chat tab first.";return;}
  await chrome.tabs.sendMessage(tab.id,{action});
  statusEl.textContent="Command sent.";
 }catch(e){statusEl.textContent="Refresh the Dopple tab after installing or reloading the extension, then try again.";}
}
document.getElementById("read").onclick=()=>send("READ_LATEST");
document.getElementById("test").onclick=()=>send("TEST_VOICE");
document.getElementById("stop").onclick=()=>send("STOP");