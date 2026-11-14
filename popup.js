const status=document.getElementById("status");
async function send(action){
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const host=tab?.url?new URL(tab.url).hostname:"";
  const isChat=host==="chatgpt.com"||host==="chat.openai.com";
  const isCAI=host==="character.ai"||host.endsWith(".character.ai");
  if(!tab?.id||(!isChat&&!isCAI)){status.textContent="Open ChatGPT or Character.AI in this tab first.";return}
  const target=isCAI?"CAI":"CHATGPT",msg={action:action==="START"?(isCAI?"START_CAI":"START"):"STOP"};
  try{await chrome.tabs.sendMessage(tab.id,msg)}
  catch(first){status.textContent="Connecting extension…";await chrome.scripting.executeScript({target:{tabId:tab.id},files:["content.js"]});await new Promise(r=>setTimeout(r,250));await chrome.tabs.sendMessage(tab.id,msg)}
  status.textContent=action==="START"?(isCAI?"Character.AI keepalive + mic started.":"ChatGPT loop started — mic is active."):"Stopped.";
 }catch(e){status.textContent="Couldn't connect: "+(e.message||"unknown error");console.error("[Voice Dictator popup]",e)}
}
document.getElementById("start").onclick=()=>send("START");
document.getElementById("stop").onclick=()=>send("STOP");