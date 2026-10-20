(() => {
 const $ = selector => document.querySelector(selector);
 const statusText=$("#status-text"),indicator=$("#indicator"),preview=$("#preview"),toggle=$("#toggle"),auto=$("#auto"),openInworld=$("#open-inworld");
 const apiKey=$("#api-key"),voiceId=$("#voice-id"),modelId=$("#model-id"),speakingRate=$("#speaking-rate"),saveApi=$("#save-api");
 let listening=false;
 const status=message=>{statusText.textContent=message||"Ready.";};
 const renderListening=()=>{toggle.textContent=listening?"■ Stop dictation":"🎙 Start dictation + generation";toggle.classList.toggle("stop",listening);indicator.classList.toggle("on",listening);};
 toggle.addEventListener("click",()=>{toggle.disabled=true;status("Starting background dictation engine…");chrome.runtime.sendMessage({type:"IVD_TOGGLE_LISTENING"},response=>{toggle.disabled=false;if(chrome.runtime.lastError){status("Extension messaging error: "+chrome.runtime.lastError.message);return;}if(!response){status("No response from dictation engine. Reload the extension.");return;}listening=!!response.listening;renderListening();status(response.message||(listening?"Dictation active.":"Dictation stopped."));});});
 chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="IVD_OFFSCREEN_STATUS"){listening=!!message.listening;renderListening();status(message.message||(listening?"Listening…":"Dictation stopped."));}
  if(message?.type==="IVD_OFFSCREEN_TRANSCRIPT"&&message.text)preview.textContent=message.text;
  if(message?.type==="IVD_API_AUDIO"&&message.audioBase64){
   (async()=>{let url;try{status("Playing Inworld-generated speech…");const raw=atob(message.audioBase64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const blob=new Blob([bytes],{type:message.mimeType||"audio/mpeg"});url=URL.createObjectURL(blob);const audio=new Audio(url);audio.onended=()=>URL.revokeObjectURL(url);audio.onerror=()=>{URL.revokeObjectURL(url);status("Audio playback failed. Check Windows output device and volume.");};await audio.play();status("Speaking generated audio. Ensure Windows output is routed to the VRChat virtual microphone.");sendResponse({ok:true});}catch(error){if(url)URL.revokeObjectURL(url);status("Audio generated, but playback was blocked: "+(error?.message||String(error))+". Click the dashboard once, then try again.");sendResponse({ok:false,message:error?.message||String(error)});}})();return true;
  }
 });
 chrome.storage.local.get(["autoGenerate","inworldApiKey","inworldVoiceId","inworldModelId","inworldSpeakingRate"],data=>{
  if(chrome.runtime.lastError)return;
  if(typeof data.autoGenerate==="boolean")auto.checked=data.autoGenerate;
  apiKey.value=data.inworldApiKey||"";voiceId.value=data.inworldVoiceId||"";
  modelId.value=data.inworldModelId||"inworld-tts-2";
  speakingRate.value=String(data.inworldSpeakingRate||1);
 });
 auto.addEventListener("change",()=>chrome.storage.local.set({autoGenerate:auto.checked}));
 saveApi.addEventListener("click",async()=>{
  const key=apiKey.value.trim(),voice=voiceId.value.trim(),model=modelId.value,rate=Number(speakingRate.value);
  if(!key||!voice){status("Enter your Inworld API credential and voice ID before saving.");return;}
  if(!Number.isFinite(rate)||rate<0.5||rate>1.5){status("Speaking rate must be between 0.5 and 1.5.");return;}
  saveApi.disabled=true;
  try{await chrome.storage.local.set({inworldApiKey:key,inworldVoiceId:voice,inworldModelId:model,inworldSpeakingRate:rate,useDirectApi:true});status("Inworld settings saved. Start dictation to generate speech.");}
  catch(error){status("Could not save settings: "+(error?.message||String(error)));}
  finally{saveApi.disabled=false;}
 });
 openInworld.addEventListener("click",async()=>{try{await chrome.tabs.create({url:"https://platform.inworld.ai/"});}catch(error){status("Couldn't open Inworld Portal: "+(error?.message||String(error)));}});
 status("Ready. Save your Inworld credential and voice ID, then click Start.");
})();