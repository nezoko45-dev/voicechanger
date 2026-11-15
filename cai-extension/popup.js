const status=document.getElementById("status");
async function command(action){
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id||!tab.url||!new URL(tab.url).hostname.endsWith("character.ai")){
   status.textContent="Open Character.AI in this tab first.";return;
  }
  const send=()=>chrome.tabs.sendMessage(tab.id,{action});
  try{await chrome.tabs.sendMessage(tab.id,{action:"PING"});}
  catch{
   status.textContent="Connecting automation to this CAI tab…";
   await chrome.scripting.executeScript({target:{tabId:tab.id},files:["content.js"]});
   await new Promise(r=>setTimeout(r,150));
  }
  const result=await send();
  status.textContent=action==="START"?"Listening started. Keep CAI open; VRChat can stay foreground.":"Stopped.";
 }catch(e){status.textContent="Could not connect. Reload extension and refresh CAI tab.";console.error("CAI extension connection:",e)}
}
document.getElementById("start").onclick=()=>command("START");
document.getElementById("stop").onclick=()=>command("STOP");