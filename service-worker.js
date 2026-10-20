const OFFSCREEN_URL="offscreen.html";
let creatingOffscreen=null;
async function ensureOffscreen(){
 const contexts=await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[chrome.runtime.getURL(OFFSCREEN_URL)]});
 if(contexts.length)return;if(creatingOffscreen)return creatingOffscreen;
 creatingOffscreen=chrome.offscreen.createDocument({url:OFFSCREEN_URL,reasons:["USER_MEDIA"],justification:"Keep microphone speech recognition running while the user switches from Chrome to a full-screen game."});
 try{await creatingOffscreen;}finally{creatingOffscreen=null;}
}
async function sendToZaltPage(action,text){
 const tabs=await chrome.tabs.query({url:["https://zalt.me/tools/text-to-speech*"]});
 if(!tabs.length)return{ok:false,message:"I could not find a Zalt Text to Speech tab. Open https://zalt.me/tools/text-to-speech, then reload the extension and refresh that tab."};
 const tab=tabs.find(t=>t.active)||tabs[0];
 try{
  const response=await chrome.tabs.sendMessage(tab.id,{type:action==="preview"?"IVD_PREVIEW":"IVD_GENERATE",text});
  return response||{ok:true,message:action==="preview"?"Transcript preview sent.":"Generate Speech clicked on Zalt."};
 }catch(error){return{ok:false,message:"Couldn't reach Zalt Text to Speech. Refresh that tab after reloading the extension, then try again. "+(error?.message||"")};}
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(message?.type==="IVD_TOGGLE_LISTENING"){
  (async()=>{try{await ensureOffscreen();const result=await chrome.runtime.sendMessage({type:"IVD_OFFSCREEN_TOGGLE"});sendResponse(result||{listening:false,message:"Dictation engine did not respond. Reload the extension."});}catch(error){sendResponse({listening:false,message:"Could not start background dictation: "+(error?.message||error)});}})();return true;
 }
 if(message?.type==="IVD_BRIDGE_TO_ZALT"){
  (async()=>{try{sendResponse(await sendToZaltPage(message.action,String(message.text||"")));}catch(error){sendResponse({ok:false,message:error?.message||String(error)});}})();return true;
 }
});