(() => {
 if(window.__caiVoiceDictation)return;window.__caiVoiceDictation=true;
 let active=false,rec=null,restartTimer=null,voiceTimer=null,voiceOn=false,speechNow=false,genObserved=false,finalText='';
 const log=(...a)=>console.debug('[CAI Voice Dictation]',...a);
 const $=s=>document.querySelector(s);
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.disabled;
 function voiceButton(){return [...document.querySelectorAll('button,[role="button"]')].find(e=>visible(e)&&((e.getAttribute('aria-label')||'').trim().toLowerCase()==='voice'||(e.innerText||e.textContent||'').trim().toLowerCase()==='voice'||(e.getAttribute('title')||'').trim().toLowerCase()==='voice'))}
 function textbox(){return [...document.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"]')].find(visible)}
 function sendButton(){return [...document.querySelectorAll('button,[role="button"]')].find(e=>visible(e)&&(/send/i.test((e.getAttribute('aria-label')||'')+' '+(e.innerText||e.textContent||''))||e.querySelector('svg[data-testid*="send"]'))}
 function generating(){return [...document.querySelectorAll('button,[role="button"]')].some(e=>visible(e)&&/stop generating|stop response|cancel generation/i.test((e.getAttribute('aria-label')||'')+' '+(e.innerText||e.textContent||'')))}
 function insertAndSend(text){
  const el=textbox();if(!el){log('Chat input not found');return}
  el.focus();
  if(el.isContentEditable){el.textContent=text;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}))}
  else {const p=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')?.set;p?p.call(el,text):el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}
  setTimeout(()=>{const b=sendButton();if(b)b.click();else el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));log('sent: '+text)},120);
 }
 function pauseVoiceForSpeech(){speechNow=true;clearInterval(voiceTimer);voiceTimer=null;voiceOn=false;log('speech detected: voice timer paused')}
 function beginGenerationWait(){speechNow=false;genObserved=false;clearInterval(voiceTimer);voiceTimer=null;const poll=setInterval(()=>{if(!active){clearInterval(poll);return}if(generating()){genObserved=true;return}if(genObserved){clearInterval(poll);log('generation complete; starting 5-sec voice toggles');startVoiceTimer() }},900);setTimeout(()=>{clearInterval(poll);if(active&&!genObserved){log('generation indicator unavailable; starting voice timer');startVoiceTimer()}},90000)}
 function startVoiceTimer(){if(!active)return;clearInterval(voiceTimer);voiceTimer=setInterval(()=>{if(!active||speechNow||generating())return;const b=voiceButton();if(!b){log('Voice button not found');return}b.click();voiceOn=!voiceOn;log('Voice toggle click; state '+(voiceOn?'ON':'OFF'))},5000)}
 function startRec(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){log('Chrome SpeechRecognition unavailable');return}
  try{rec=new SR();rec.lang='en-US';rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=1;
   rec.onstart=()=>log('recognition listening');rec.onspeechstart=()=>pauseVoiceForSpeech();
   rec.onresult=e=>{let interim='',finals='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)finals+=t;else interim+=t}
    if(interim.trim())pauseVoiceForSpeech();
    if(finals.trim()){const phrase=finals.trim();log('recognized: '+phrase);insertAndSend(phrase);beginGenerationWait()}
   };
   rec.onerror=e=>log('recognition error '+e.error);rec.onend=()=>{if(active){clearTimeout(restartTimer);restartTimer=setTimeout(startRec,650)}};
   rec.start();
  }catch(e){log('start recognition: '+e.message);restartTimer=setTimeout(startRec,1200)}
 }
 function set(v){active=!!v;chrome.storage.local.set({enabled:active});if(active){startRec();log('enabled')}else{try{rec&&rec.stop()}catch{}clearTimeout(restartTimer);clearInterval(voiceTimer);voiceTimer=null;log('disabled')}}
 chrome.runtime.onMessage.addListener(m=>{if(m.type==='SET')set(m.enabled)});
 chrome.storage.local.get({enabled:false},x=>{if(x.enabled)set(true)});
})();