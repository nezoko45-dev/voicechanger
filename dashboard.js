(() => {
 const $ = selector => document.querySelector(selector);
 const statusText=$("#status-text"),indicator=$("#indicator"),preview=$("#preview"),toggle=$("#toggle"),auto=$("#auto"),openEleven=$("#open-eleven");
 const directApi=$("#direct-api"),apiKey=$("#api-key"),voiceId=$("#voice-id"),modelId=$("#model-id"),saveApi=$("#save-api");
 let listening=false;
 const status=message=>{statusText.textContent=message||"Ready.";};
 const renderListening=()=>{toggle.textContent=listening?"■ Stop dictation":"🎙 Start dictation";toggle.classList.toggle("stop",listening);indicator.classList.toggle("on",listening);};
 toggle.addEventListener("click",()=>{toggle.disabled=true;status("Starting background dictation engine…");chrome.runtime.sendMessage({type:"IVD_TOGGLE_LISTENING"},response=>{toggle.disabled=false;if(chrome.runtime.lastError){status("Extension messaging error: "+chrome.runtime.lastError.message);return;}if(!response){status("No response from dictation engine. Reload the extension.");return;}listening=!!response.listening;renderListening();status(response.message||(listening?"Background dictation active.":"Dictation stopped."));});});
 chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(message?.type==="IVD_OFFSCREEN_STATUS"){listening=!!message.listening;renderListening();status(message.message||(listening?"Listening…":"Dictation stopped."));}
  if(message?.type==="IVD_OFFSCREEN_TRANSCRIPT"&&message.text)preview.textContent=message.text;
  if(message?.type==="IVD_API_AUDIO"&&message.audioBase64){
   (async()=>{try{status("Playing generated speech…");const raw=atob(message.audioBase64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const blob=new Blob([bytes],{type:message.mimeType||"audio/mpeg"});const url=URL.createObjectURL(blob);const audio=new Audio(url);audio.onended=()=>URL.revokeObjectURL(url);audio.onerror=()=>{URL.revokeObjectURL(url);status("Audio playback failed. Check Windows output device and volume.");};await audio.play();status("Speaking generated audio. Keep Windows audio routed to your VRChat virtual microphone.");sendResponse({ok:true});}catch(error){status("Audio generated, but playback was blocked: "+(error?.message||String(error))+". Click the dashboard once, then try again.");sendResponse({ok:false,message:error?.message||String(error)});}})();return true;
  }
 });
 chrome.storage.local.get(["autoGenerate","useDirectApi","elevenLabsApiKey","voiceId","modelId"],data=>{
  if(chrome.runtime.lastError)return;
  if(typeof data.autoGenerate==="boolean")auto.checked=data.autoGenerate;
  directApi.checked=!!data.useDirectApi;
  apiKey.value=data.elevenLabsApiKey||"";
  voiceId.value=data.voiceId||"";
  modelId.value=data.modelId||"eleven_flash_v2_5";
 });
 auto.addEventListener("change",()=>chrome.storage.local.set({autoGenerate:auto.checked}));
 saveApi.addEventListener("click",async()=>{
  const key=apiKey.value.trim(),voice=voiceId.value.trim(),model=modelId.value;
  if(directApi.checked&&(!key||!voice)){status("Enter your API key and voice ID before enabling Direct API.");return;}
  saveApi.disabled=true;
  try{await chrome.storage.local.set({useDirectApi:directApi.checked,elevenLabsApiKey:key,voiceId:voice,modelId:model});status(directApi.checked?"Direct API settings saved. New phrases will bypass the ElevenLabs webpage.":"Settings saved. Website generation remains selected.");}
  catch(error){status("Could not save settings: "+(error?.message||String(error)));}
  finally{saveApi.disabled=false;}
 });
 openEleven.addEventListener("click",async()=>{try{const tabs=await chrome.tabs.query({url:["https://elevenlabs.io/*","https://*.elevenlabs.io/*"]});const tab=tabs.find(t=>t.url&&t.url.includes("/app/speech-synthesis/"))||tabs[0];if(tab?.id){await chrome.tabs.update(tab.id,{active:true});if(typeof tab.windowId==="number")await chrome.windows.update(tab.windowId,{focused:true});status("Switched to your ElevenLabs tab.");}else{await chrome.tabs.create({url:"https://elevenlabs.io/app/speech-synthesis/text-to-speech"});status("Opened ElevenLabs Text to Speech in a new tab.");}}catch(error){status("Couldn't open ElevenLabs: "+(error?.message||String(error)));}});
 status("Ready. Open ElevenLabs Text to Speech, or configure Direct API to bypass the webpage.");
})();