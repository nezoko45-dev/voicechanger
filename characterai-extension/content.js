(() => {
 if(window.__caiKeepaliveLoaded)return;window.__caiKeepaliveLoaded=true;
 let enabled=false,timer=null,speakingUntil=0,lastUserSpeech=0,observedGenerating=false;
 const log=(...x)=>console.debug('[CAI keepalive]',...x);
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.disabled;
 function voiceButton(){
   const els=[...document.querySelectorAll('button,[role="button"]')];
   return els.find(e=>visible(e)&&((e.getAttribute('aria-label')||'').trim().toLowerCase()==='voice'||(e.innerText||e.textContent||'').trim().toLowerCase()==='voice'||(e.getAttribute('title')||'').trim().toLowerCase()==='voice'));
 }
 function generating(){
   return [...document.querySelectorAll('button,[role="button"]')].some(e=>visible(e)&&/stop generating|stop response|cancel generation/i.test((e.getAttribute('aria-label')||'')+' '+(e.innerText||e.textContent||'')));
 }
 function isSpeaking(){return Date.now()<speakingUntil||Date.now()-lastUserSpeech<1800}
 function tick(){
   if(!enabled)return;
   if(isSpeaking()){log('paused: speech');return}
   if(generating()){observedGenerating=true;log('paused: generating');return}
   if(observedGenerating){observedGenerating=false;log('generation ended; resume next cycle');return}
   const b=voiceButton();
   if(!b){log('Voice control not found in DOM (check page/tab)');return}
   b.click();log('clicked Voice button');
 }
 function start(){clearInterval(timer);timer=setInterval(tick,5000);setTimeout(tick,700)}
 function set(v){enabled=!!v;if(enabled)start();else clearInterval(timer);log(enabled?'enabled':'disabled')}
 chrome.storage.local.get({enabled:false},v=>set(v.enabled));
 chrome.storage.onChanged.addListener((c,a)=>{if(c.enabled)set(c.enabled.newValue)});
 chrome.runtime.onMessage.addListener(m=>{if(m.type==='SET')set(m.enabled)});
 // Speech recognition final/interim text signals pause promptly.
 const speech=()=>{lastUserSpeech=Date.now();speakingUntil=Date.now()+2200};
 document.addEventListener('input',e=>{if(e.target&&(/text|search/i.test(e.target.type||'')||e.target.isContentEditable))return},true);
 // Optional bridge from dictation page: window.postMessage({type:'CAI_USER_SPEAKING'},'*')
 window.addEventListener('message',e=>{if(e.data&&e.data.type==='CAI_USER_SPEAKING')speech()});
 // Pause if mic audio is detected via WebAudio is not possible from a content script;
 // dictation recognizer can signal speech with the bridge above.
 const mo=new MutationObserver(()=>{if(generating())observedGenerating=true});
 mo.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-label','disabled']});
})();