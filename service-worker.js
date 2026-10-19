const OFFSCREEN_URL = "offscreen.html";
let creatingOffscreen = null;
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[chrome.runtime.getURL(OFFSCREEN_URL)]});
  if (contexts.length) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen.createDocument({url:OFFSCREEN_URL,reasons:["USER_MEDIA"],justification:"Keep microphone speech recognition running while the user switches from Chrome to a full-screen game."});
  try { await creatingOffscreen; } finally { creatingOffscreen = null; }
}
async function sendToElevenLabs(type, text) {
  const tabs = await chrome.tabs.query({url:["https://elevenlabs.io/*","https://*.elevenlabs.io/*"]});
  const tab = tabs.find(tab => tab.active) || tabs[0];
  if (!tab?.id) return {ok:false,message:"No ElevenLabs tab found. Open the Text to Speech page and refresh it."};
  try { return await chrome.tabs.sendMessage(tab.id,{type,text}); }
  catch (error) { return {ok:false,message:"Cannot reach the ElevenLabs tab. Open the Text to Speech page and refresh it so the extension can connect."}; }
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="IVD_TOGGLE_LISTENING"){
    (async()=>{try{await ensureOffscreen();const result=await chrome.runtime.sendMessage({type:"IVD_OFFSCREEN_TOGGLE"});sendResponse(result||{listening:false,message:"Dictation engine did not respond. Reload the extension."});}
    catch(error){sendResponse({listening:false,message:"Could not start background dictation: "+(error?.message||error)});}})();
    return true;
  }
  if(message?.type==="IVD_BRIDGE_TO_ELEVENLABS"){
    sendToElevenLabs(message.action==="generate"?"IVD_GENERATE":"IVD_PREVIEW",message.text).then(sendResponse).catch(error=>sendResponse({ok:false,message:error?.message||String(error)}));
    return true;
  }
});
