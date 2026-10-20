const OFFSCREEN_URL = "offscreen.html";
let creatingOffscreen = null;
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"],documentUrls:[chrome.runtime.getURL(OFFSCREEN_URL)]});
  if (contexts.length) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen.createDocument({url:OFFSCREEN_URL,reasons:["USER_MEDIA"],justification:"Keep microphone speech recognition running while the user switches from Chrome to a full-screen game."});
  try { await creatingOffscreen; } finally { creatingOffscreen = null; }
}
async function generateWithInworld(text) {
  const settings = await chrome.storage.local.get(["inworldApiKey","inworldVoiceId","inworldModelId","inworldSpeakingRate"]);
  const apiKey = String(settings.inworldApiKey || "").trim();
  const voiceId = String(settings.inworldVoiceId || "").trim();
  const modelId = String(settings.inworldModelId || "inworld-tts-2");
  const speakingRate = Number(settings.inworldSpeakingRate || 1);
  const phrase = String(text || "").trim();
  if (!apiKey || !voiceId) return {ok:false,message:"Inworld settings are missing. Open the dashboard and save your API credential and voice ID."};
  if (!phrase) return {ok:false,message:"No speech text was captured."};
  if (phrase.length > 2000) return {ok:false,message:"This phrase is over Inworld's 2,000-character single-request limit. Try a shorter phrase."};
  const response = await fetch("https://api.inworld.ai/tts/v1/voice", {
    method:"POST",
    headers:{"Authorization":"Basic " + apiKey,"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify({text:phrase,voiceId,modelId,audioConfig:{audioEncoding:"MP3",sampleRateHertz:24000},speakingRate})
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0,500);
    if (response.status === 401 || response.status === 403) return {ok:false,message:"Inworld authentication or permission failed. Paste the complete Base64 credential from the Portal; do not encode it again."};
    if (response.status === 429) return {ok:false,message:"Inworld rate or usage limit reached. Check your account usage."};
    return {ok:false,message:"Inworld API returned HTTP " + response.status + (detail ? ": " + detail : "")};
  }
  const data = await response.json();
  if (!data.audioContent) return {ok:false,message:"Inworld returned no audio content."};
  try {
    const result = await chrome.runtime.sendMessage({type:"IVD_API_AUDIO",audioBase64:data.audioContent,mimeType:"audio/mpeg"});
    if (result?.ok === false) return {ok:false,message:"Speech generated, but browser playback failed: "+(result.message||"Click the dashboard once and retry.")};
    return {ok:true,message:"Inworld generated speech. Audio is playing through the dashboard."};
  } catch (error) {
    return {ok:false,message:"Speech generated, but dashboard playback failed. Keep dashboard.html open and click it once to allow audio playback."};
  }
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="IVD_TOGGLE_LISTENING"){
    (async()=>{try{await ensureOffscreen();const result=await chrome.runtime.sendMessage({type:"IVD_OFFSCREEN_TOGGLE"});sendResponse(result||{listening:false,message:"Dictation engine did not respond. Reload the extension."});}
    catch(error){sendResponse({listening:false,message:"Could not start background dictation: "+(error?.message||error)});}})();
    return true;
  }
  if(message?.type==="IVD_BRIDGE_TO_ELEVENLABS"){
    if(message.action==="preview"){sendResponse({ok:true,message:"Transcript preview updated."});return;}
    (async()=>{try{sendResponse(await generateWithInworld(String(message.text||"")));}
    catch(error){sendResponse({ok:false,message:error?.message||String(error)});}})();
    return true;
  }
});