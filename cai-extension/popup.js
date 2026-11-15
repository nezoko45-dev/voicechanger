const status=document.getElementById("status");
async function command(action){
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id||!tab.url||!new URL(tab.url).hostname.endsWith("character.ai")){
   status.textContent="Open Character.AI in this tab first.";return;
  }
  try{await chrome.tabs.sendMessage(tab.id,{action});}
  catch(e){await chrome.scripting.executeScript({target:{tabId:tab.id},files:["content.js"]});await new Promise(r=>setTimeout(r,250));await chrome.tabs.sendMessage(tab.id,{action});}
  status.textContent=action==="START"?"Listening started. Keep this tab open; VRChat can stay foreground.":"Stopped.";
 }catch(e){status.textContent="Error: "+e.message;console.error(e)}
}
document.getElementById("start").onclick=()=>command("START");
document.getElementById("stop").onclick=()=>command("STOP");