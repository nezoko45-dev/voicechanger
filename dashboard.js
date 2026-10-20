(() => {
 const $=s=>document.querySelector(s),statusText=$("#status-text"),indicator=$("#indicator"),preview=$("#preview"),toggle=$("#toggle"),auto=$("#auto"),openInworld=$("#open-inworld"),elToggle=$("#el-toggle"),elEnabled=$("#el-enabled"),elStatus=$("#el-status-text"),elIndicator=$("#el-indicator");
 let listening=false;
 const status=message=>{statusText.textContent=message||"Ready.";};
 const render=()=>{toggle.textContent=listening?"■ Stop dictation":"🎙 Start dictation + Generate";toggle.classList.toggle("stop",listening);indicator.classList.toggle("on",listening);};
 toggle.addEventListener("click",()=>{toggle.disabled=true;status("Starting background dictation…");chrome.runtime.sendMessage({type:"IVD_TOGGLE_LISTENING"},response=>{toggle.disabled=false;if(chrome.runtime.lastError){status("Extension messaging error: "+chrome.runtime.lastError.message);return;}if(!response){status("No response from dictation engine. Reload the extension.");return;}listening=!!response.listening;render();status(response.message||(listening?"Dictation active.":"Dictation stopped."));});});
 chrome.runtime.onMessage.addListener(message=>{if(message?.type==="IVD_OFFSCREEN_STATUS"){listening=!!message.listening;render();status(message.message||(listening?"Listening…":"Dictation stopped."));}if(message?.type==="IVD_OFFSCREEN_TRANSCRIPT"&&message.text)preview.textContent=message.text;});
 chrome.storage.local.get(["autoGenerate"],data=>{if(typeof data.autoGenerate==="boolean")auto.checked=data.autoGenerate;});
 auto.addEventListener("change",()=>chrome.storage.local.set({autoGenerate:auto.checked}));
 openInworld.addEventListener("click",async()=>{try{const url="https://zalt.me/tools/text-to-speech";const tabs=await chrome.tabs.query({url:["https://zalt.me/tools/text-to-speech*"]});if(tabs.length){await chrome.tabs.update(tabs[0].id,{active:true});await chrome.windows.update(tabs[0].windowId,{focused:true});}else await chrome.tabs.create({url});status("Zalt Text to Speech opened. Select your preferred voice if needed.");}catch(error){status("Couldn't open Zalt Text to Speech: "+(error?.message||String(error)));}});

 const renderEl=active=>{elToggle.textContent=active?"■ Stop autoclicker":"▶ Start autoclicker";elToggle.classList.toggle("stop",active);elEnabled.checked=active;elIndicator.classList.toggle("on",active);};
 const setEl=async active=>{await chrome.storage.local.set({elevenLabsAutoClickEnabled:active});renderEl(active);elStatus.textContent=active?"Monitoring ElevenLabs tabs for “Start a call”…":"Autoclicker stopped.";};
 chrome.storage.local.get(["elevenLabsAutoClickEnabled"],d=>renderEl(!!d.elevenLabsAutoClickEnabled));
 elToggle.addEventListener("click",()=>setEl(!elEnabled.checked));
 elEnabled.addEventListener("change",()=>setEl(elEnabled.checked));
 $("#el-open").addEventListener("click",async()=>{try{const tabs=await chrome.tabs.query({url:["https://elevenlabs.io/*","https://*.elevenlabs.io/*"]});if(tabs.length){await chrome.tabs.update(tabs[0].id,{active:true});await chrome.windows.update(tabs[0].windowId,{focused:true});}else await chrome.tabs.create({url:"https://elevenlabs.io/app/agents"});elStatus.textContent="ElevenLabs opened. Open your agent page; then enable the autoclicker.";}catch(e){elStatus.textContent="Couldn't open ElevenLabs: "+(e?.message||e);}});
 chrome.runtime.onMessage.addListener(message=>{if(message?.type==="ELEVENLABS_AUTOCLICK_STATUS")elStatus.textContent=message.message;});
 status("Open Zalt Text to Speech and keep that tab open.");
})();