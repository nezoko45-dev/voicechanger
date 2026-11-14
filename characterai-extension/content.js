(() => {
 if(window.__caiVoiceDictation)return;window.__caiVoiceDictation=true;
 let active=false,rec=null,restartTimer=null,voiceTimer=null,voiceOn=false,speechNow=false,genObserved=false,finalText='';
 const log=(...a)=>console.debug('[CAI Voice Dictation]',...a);
 const $=s=>document.querySelector(s);
 const visible=e=>!!e&&e.getClientRects().length>0&&!e.disabled;
 function voiceButton(){
  // Inspect likely Voice controls by exact text and icon/accessible attributes.
  const candidates=[...document.querySelectorAll('button,[role="button"],[role="switch"],[tabindex="0"]')].filter(visible);
  const score=e=>{
    const text=(e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim().toLowerCase();
    const aria=(e.getAttribute('aria-label')||'').toLowerCase();
    const title=(e.getAttribute('title')||'').toLowerCase();
    const testid=(e.getAttribute('data-testid')||'').toLowerCase();
    const cls=(typeof e.className==='string'?e.className:'').toLowerCase();
    let n=0;
    if(text==='voice')n+=10;
    if(aria==='voice'||title==='voice')n+=10;
    if(/voice/.test(aria+' '+title+' '+testid+' '+cls))n+=4;
    if(e.querySelector('svg'))n+=1;
    if(text.length<30)n+=1;
    return n;
  };
  const ranked=candidates.map(e=>({e,n:score(e)})).sort((x,y)=>y.n-x.n);
  const top=ranked[0];
  if(top&&top.n>=10){
    log('Voice control identified', {tag:top.e.tagName,text:(top.e.innerText||top.e.textContent||'').trim(),aria:top.e.getAttribute('aria-label'),title:top.e.getAttribute('title'),testid:top.e.getAttribute('data-testid'),html:top.e.outerHTML.slice(0,500)});
    return top.e;
  }
  log('VOICE CONTROL DIAGNOSTIC — candidates',ranked.slice(0,12).map(x=>({score:x.n,tag:x.e.tagName,text:(x.e.innerText||x.e.textContent||'').trim().slice(0,60),aria:x.e.getAttribute('aria-label'),title:x.e.getAttribute('title'),testid:x.e.getAttribute('data-testid'),html:x.e.outerHTML.slice(0,240)})));
  return null;
 }
 function textbox(){
  // Character.AI composer is normally the textbox/contenteditable with a message placeholder.
  const all=[...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')].filter(visible);
  return all.find(e=>/message|chat|talk|reply/i.test((e.getAttribute('placeholder')||'')+' '+(e.getAttribute('data-placeholder')||'')+' '+(e.getAttribute('aria-label')||'')))||all.find(e=>e.matches('[contenteditable="true"],[role="textbox"]'))||all.find(e=>e.tagName==='TEXTAREA');
 }
 function sendButton(){
  const composer=textbox();
  const scope=composer?.closest('form')||document;
  const candidates=[...scope.querySelectorAll('button,[role="button"]')].filter(visible);
  return candidates.find(e=>{
    const label=(e.getAttribute('aria-label')||'')+' '+(e.getAttribute('title')||'')+' '+(e.innerText||e.textContent||'');
    return /send/i.test(label)||!!e.querySelector('svg[data-testid*="send"],svg[aria-label*="send" i]');
  })||candidates.find(e=>e.getAttribute('type')==='submit');
 }
 function generating(){return [...document.querySelectorAll('button,[role="button"]')].some(e=>visible(e)&&/stop generating|stop response|cancel generation/i.test((e.getAttribute('aria-label')||'')+' '+(e.innerText||e.textContent||'')))}
 function insertAndSend(text){
  const el=textbox();if(!el){log('Character.AI composer not found');return}
  el.focus();
  if(el.isContentEditable){
    el.replaceChildren(document.createTextNode(text));
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
  }else{
    const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
    if(setter)setter.call(el,text);else el.value=text;
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
  }
  setTimeout(()=>{
    const form=el.closest('form');let submitted=false;
    // Submit through the actual composer form first (React listens to submit).
    if(form&&typeof form.requestSubmit==='function'){
      try{form.requestSubmit();submitted=true;log('submitted via composer form')}catch(err){log('form submit failed '+err)}
    }
    if(!submitted){
      const b=sendButton();
      if(b){try{b.click();submitted=true;log('submitted via Send button')}catch(err){log('Send click failed '+err)}}
    }
    if(!submitted){
      // Last-resort Enter event sequence; form submission above is the trusted DOM path.
      el.focus();el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
      el.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
      log('Enter fallback dispatched');
    }
    log('final transcript: '+text);
  },250);
 }
 function pauseVoiceForSpeech(){speechNow=true;clearInterval(voiceTimer);voiceTimer=null;voiceOn=false;log('speech detected: voice timer paused')}
 function beginGenerationWait(){speechNow=false;genObserved=false;clearInterval(voiceTimer);voiceTimer=null;const poll=setInterval(()=>{if(!active){clearInterval(poll);return}if(generating()){genObserved=true;return}if(genObserved){clearInterval(poll);log('generation complete; starting 5-sec voice toggles');startVoiceTimer() }},900);setTimeout(()=>{clearInterval(poll);if(active&&!genObserved){log('generation indicator unavailable; starting voice timer');startVoiceTimer()}},90000)}
 function startVoiceTimer(){if(!active)return;clearInterval(voiceTimer);voiceTimer=setInterval(()=>{
  if(!active||speechNow||generating())return;
  const b=voiceButton();
  if(!b){log('Voice button not found; visible buttons: '+[...document.querySelectorAll('button,[role="button"]')].filter(visible).map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim()).slice(0,30).join(' | '));return}
  b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
  b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
  b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
  b.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  b.click();voiceOn=!voiceOn;log('Voice button clicked; toggle '+(voiceOn?'ON':'OFF'));
},5000)}
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
 function set(v){active=!!v;chrome.storage.local.set({enabled:active});if(active){startRec();startVoiceTimer();log('enabled; idle Voice toggling started')}else{try{rec&&rec.stop()}catch{}clearTimeout(restartTimer);clearInterval(voiceTimer);voiceTimer=null;log('disabled')}}
 chrome.runtime.onMessage.addListener(m=>{if(m.type==='SET')set(m.enabled)});
 chrome.storage.local.get({enabled:false},x=>{if(x.enabled)set(true)});
})();