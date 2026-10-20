(() => {
 const $=s=>document.querySelector(s);
 const toggle=$("#el-toggle"),enabledBox=$("#el-enabled"),statusText=$("#el-status-text"),indicator=$("#el-indicator");
 const render=active=>{toggle.textContent=active?"■ Stop autoclicker":"▶ Start autoclicker";toggle.classList.toggle("stop",active);enabledBox.checked=active;indicator.classList.toggle("on",active);};
 const setEnabled=async active=>{await chrome.storage.local.set({elevenLabsAutoClickEnabled:active});render(active);statusText.textContent=active?"Monitoring ElevenLabs tabs for “Start a call”…":"Autoclicker stopped.";};
 chrome.storage.local.get(["elevenLabsAutoClickEnabled"],async data=>{if(typeof data.elevenLabsAutoClickEnabled==="undefined"){await chrome.storage.local.set({elevenLabsAutoClickEnabled:true});render(true);statusText.textContent="Autoclicker enabled by default. Opening an ElevenLabs agent page will automatically start the call.";}else render(!!data.elevenLabsAutoClickEnabled);});
 toggle.addEventListener("click",()=>setEnabled(!enabledBox.checked));
 enabledBox.addEventListener("change",()=>setEnabled(enabledBox.checked));
 $("#el-open").addEventListener("click",async()=>{try{const tabs=await chrome.tabs.query({url:["https://elevenlabs.io/*","https://*.elevenlabs.io/*"]});if(tabs.length){await chrome.tabs.update(tabs[0].id,{active:true});await chrome.windows.update(tabs[0].windowId,{focused:true});}else await chrome.tabs.create({url:"https://elevenlabs.io/app/agents"});statusText.textContent="ElevenLabs opened. Navigate to your agent page, then start the autoclicker.";}catch(e){statusText.textContent="Couldn't open ElevenLabs: "+(e?.message||e);}});
 chrome.runtime.onMessage.addListener(message=>{if(message?.type==="ELEVENLABS_AUTOCLICK_STATUS")statusText.textContent=message.message;});
})();