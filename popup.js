const status=document.getElementById("status");
async function send(action){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id){status.textContent="No active tab.";return}
chrome.tabs.sendMessage(tab.id,{action},response=>{if(chrome.runtime.lastError){status.textContent="Open/refresh ChatGPT, then try again.";return}status.textContent=response?.status||"Command sent."})}
document.getElementById("start").onclick=()=>send("START");
document.getElementById("stop").onclick=()=>send("STOP");