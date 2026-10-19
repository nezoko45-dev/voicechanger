const OFFSCREEN_URL = "offscreen.html";
let creatingOffscreen = null;
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[chrome.runtime.getURL(OFFSCREEN_URL)]});
  if (contexts.length) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen.createDocument({url:OFFSCREEN_URL,reasons:["USER_MEDIA"],justification:"Keep microphone speech recognition running while the user switches from Chrome to a full-screen game."});
  try { await creatingOffscreen; } finally { creatingOffscreen = null; }
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="IVD_TOGGLE_LISTENING"){
    (async()=>{try{await ensureOffscreen();const result=await chrome.runtime.sendMessage({type:"IVD_OFFSCREEN_TOGGLE"});sendResponse(result||{listening:false,message:"Dictation engine did not respond. Reload the extension."});}
    catch(error){sendResponse({listening:false,message:"Couldn't start background dictation: "+(error?.message||error)});}})();
    return true;
  }
  if(message?.type==="IVD_OFFSCREEN_STATUS"||message?.type==="IVD_OFFSCREEN_TRANSCRIPT"){
    chrome.runtime.sendMessage(message).catch(()=>{});
  }
});