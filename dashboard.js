(() => {
 const $=s=>document.querySelector(s),statusText=$("#status-text"),indicator=$("#indicator"),preview=$("#preview"),toggle=$("#toggle"),auto=$("#auto"),openInworld=$("#open-inworld");
 let listening=false;
 const status=message=>{statusText.textContent=message||"Ready.";};
 const render=()=>{toggle.textContent=listening?"■ Stop dictation":"🎙 Start dictation + Generate";toggle.classList.toggle("stop",listening);indicator.classList.toggle("on",listening);};
 toggle.addEventListener("click",()=>{toggle.disabled=true;status("Starting background dictation…");chrome.runtime.sendMessage({type:"IVD_TOGGLE_LISTENING"},response=>{toggle.disabled=false;if(chrome.runtime.lastError){status("Extension messaging error: "+chrome.runtime.lastError.message);return;}if(!response){status("No response from dictation engine. Reload the extension.");return;}listening=!!response.listening;render();status(response.message||(listening?"Dictation active.":"Dictation stopped."));});});
 chrome.runtime.onMessage.addListener(message=>{if(message?.type==="IVD_OFFSCREEN_STATUS"){listening=!!message.listening;render();status(message.message||(listening?"Listening…":"Dictation stopped."));}if(message?.type==="IVD_OFFSCREEN_TRANSCRIPT"&&message.text)preview.textContent=message.text;});
 chrome.storage.local.get(["autoGenerate"],data=>{if(typeof data.autoGenerate==="boolean")auto.checked=data.autoGenerate;});
 auto.addEventListener("change",()=>chrome.storage.local.set({autoGenerate:auto.checked}));
 openInworld.addEventListener("click",async()=>{try{const url="https://zalt.me/tools/text-to-speech";const tabs=await chrome.tabs.query({url:["https://zalt.me/tools/text-to-speech*"]});if(tabs.length){await chrome.tabs.update(tabs[0].id,{active:true});await chrome.windows.update(tabs[0].windowId,{focused:true});}else await chrome.tabs.create({url});status("Zalt Text to Speech opened. Select your preferred voice if needed.");}catch(error){status("Couldn't open Zalt Text to Speech: "+(error?.message||String(error)));}});
 status("Open Zalt Text to Speech and keep that tab open.");
})();