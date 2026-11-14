const status=document.getElementById("status");
async function send(action){
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id||!tab.url||!["chatgpt.com","chat.openai.com"].includes(new URL(tab.url).hostname)){
   status.textContent="Open ChatGPT in this tab first.";return;
  }
  try{await chrome.tabs.sendMessage(tab.id,{action});}
  catch(first){
   status.textContent="Connecting extension…";
   await chrome.scripting.executeScript({target:{tabId:tab.id},files:["content.js"]);
   await new Promise(r=>setTimeout(r,250));
   await chrome.tabs.sendMessage(tab.id,{action});
  }
  status.textContent=action==="START"?"Loop started — mic is active.":"Stopped.";
 }catch(e){
  status.textContent="Couldn't connect: "+(e.message||"unknown error")+". Check extension permissions.";
  console.error("[Voice Dictator popup]",e);
 }
}
document.getElementById("start").onclick=()=>send("START");
document.getElementById("stop").onclick=()=>send("STOP");