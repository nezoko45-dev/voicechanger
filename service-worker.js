const OFFSCREEN_URL="offscreen.html",TTS_HOST="ttslab.dev";
let creatingOffscreen=null;
async function ensureOffscreen(){
 const contexts=await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[chrome.runtime.getURL(OFFSCREEN_URL)]});
 if(contexts.length)return;
 if(!creatingOffscreen)creatingOffscreen=chrome.offscreen.createDocument({url:OFFSCREEN_URL,reasons:["USER_MEDIA"],justification:"Capture speech in the background and submit phrases to the user's open TTSLab tab."});
 try{await creatingOffscreen;}finally{creatingOffscreen=null;}
}
async function findTtsTab(){
 const tabs=await chrome.tabs.query({});
 const matches=tabs.filter(tab=>{try{const host=new URL(tab.url||"").hostname.toLowerCase();return host===TTS_HOST||host.endsWith("."+TTS_HOST);}catch{return false;}});
 return matches.find(tab=>tab.active)||matches[0]||null;
}
async function submitToTts(text){
 const tab=await findTtsTab();
 if(!tab?.id)return{ok:false,message:"Open the TTSLab tool/model page in a Chrome tab first. Dictation stays running; this phrase was not submitted."};
 try{return await chrome.tabs.sendMessage(tab.id,{type:"TT_FAST_SUBMIT",text});}
 catch(error){return{ok:false,message:"Can't reach the TTSLab page. Refresh that page once, then try again. "+(error?.message||"")};}
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(message?.type==="TT_FAST_TOGGLE"||message?.type==="TT_FAST_STATUS"){
  (async()=>{try{await ensureOffscreen();const result=await chrome.runtime.sendMessage({type:message.type==="TT_FAST_TOGGLE"?"TT_OFFSCREEN_TOGGLE":"TT_OFFSCREEN_STATUS"});sendResponse(result||{listening:false,message:"Dictation engine didn't respond. Reload the extension."});}catch(error){sendResponse({listening:false,message:"Could not start background dictation: "+(error?.message||String(error))});}})();return true;
 }
 if(message?.type==="TT_FAST_SUBMIT"){submitToTts(String(message.text||"")).then(sendResponse).catch(error=>sendResponse({ok:false,message:error?.message||String(error)}));return true;}
});
