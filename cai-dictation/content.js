(() => {
  if (window.__caiDictationInstalled) return;
  window.__caiDictationInstalled = true;
  const SILENCE_TO_SEND_MS=1200;
  let recognition=null,listening=false,restartTimer=null,sendTimer=null,restartDelay=500,generation=0;
  const selectors=['textarea[placeholder]','[contenteditable="true"][role="textbox"]','[contenteditable="true"]','textarea'];
  function composer(){for(const sel of selectors){const nodes=[...document.querySelectorAll(sel)];const el=nodes.reverse().find(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&!e.disabled&&!e.readOnly});if(el)return el}return null}
  function read(el){return el.isContentEditable?el.textContent.trim():(el.value||'').trim()}
  function setText(el,text){el.focus();if(el.isContentEditable||el.getAttribute('contenteditable')==='true'){el.textContent=text;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}))}else{const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')?.set;setter?setter.call(el,text):el.value=text;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));try{el.setSelectionRange(text.length,text.length)}catch{}}el.dispatchEvent(new Event('change',{bubbles:true}))}
  function sendButton(el){const scope=el.closest('form')||el.parentElement?.parentElement?.parentElement||document;return[...scope.querySelectorAll('button')].find(b=>!b.disabled&&b.getAttribute('aria-disabled')!=='true'&&/send|submit|send-message|submit-message/i.test([b.getAttribute('aria-label'),b.title,b.innerText,b.getAttribute('data-testid')].join(' ')))}
  function replyPlayButtons(){
    const main=document.querySelector('main,[role="main"]')||document;
    return [...main.querySelectorAll('button,[role="button"]')].filter(btn=>{
      const label=[btn.getAttribute('aria-label'),btn.getAttribute('title'),btn.getAttribute('data-testid'),btn.getAttribute('data-state')].join(' ').toLowerCase();
      const text=(btn.innerText||btn.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
      const saysPlay=/(^|\b)(play|play audio|play voice|playback|listen)(\b|$)/i.test(label)||/^play( audio| voice)?$/.test(text);
      const saysVoice=text==='voice'||label.trim()==='voice';
      if(saysVoice||/send|submit|regenerate|edit|share|copy|delete|report|like|dislike/i.test(label+' '+text))return false;
      if(saysPlay)return true;
      // Character.AI can render the blue triangle without accessible text.
      // In that case, identify the unlabeled icon button next to the "voice recorder" reply label.
      if(label.trim()||text)return false;
      const svg=btn.querySelector('svg');
      const hasIcon=!!(svg&&svg.querySelector('path,polygon,polyline'));
      if(!hasIcon)return false;
      let parent=btn.parentElement;
      for(let depth=0;parent&&depth<5;depth++,parent=parent.parentElement){
        const nearby=(parent.innerText||parent.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
        if(nearby.includes('voice recorder')&&parent.querySelector('button,[role="button"]')===btn)return true;
      }
      return false;
    });
  }
  function sendAndPlayReply(el){
    const send=sendButton(el);
    if(!send){showStatus('Silence detected, but Send was not found. Please send manually.');return}
    const previous=new Set(replyPlayButtons());
    let finished=false,observer=null,timeout=null;
    const cleanup=()=>{if(observer)observer.disconnect();if(timeout)clearTimeout(timeout)};
    const tryPlay=()=>{
      if(finished)return false;
      const button=replyPlayButtons().find(candidate=>!previous.has(candidate));
      if(!button||!button.isConnected)return false;
      finished=true;cleanup();
      setTimeout(()=>{
        if(button.isConnected){button.click();showStatus("Message sent — clicked the new reply's audio play button.")}
      },250);
      return true;
    };
    observer=new MutationObserver(()=>tryPlay());
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true});
    timeout=setTimeout(()=>{if(finished)return;finished=true;cleanup();showStatus("Message sent, but the reply's blue play button was not detected.")},45000);
    send.click();
    showStatus("Message sent — waiting for the reply's blue play button…");
    setTimeout(tryPlay,300);
  }
  function sendAfterSilence(){if(sendTimer)clearTimeout(sendTimer);sendTimer=setTimeout(()=>{sendTimer=null;const el=composer();if(!el||!read(el))return;sendAndPlayReply(el)},SILENCE_TO_SEND_MS)}
  function showStatus(message){let el=document.getElementById('__cai_dictation_status');if(!el){el=document.createElement('div');el.id='__cai_dictation_status';Object.assign(el.style,{position:'fixed',zIndex:'2147483647',bottom:'14px',right:'14px',padding:'9px 12px',borderRadius:'10px',background:'#211b2a',color:'#fff',font:'13px system-ui',boxShadow:'0 4px 20px #0005',maxWidth:'360px'});document.documentElement.appendChild(el)}el.textContent='🎙 '+message}
  function scheduleRestart(delay){if(!listening||restartTimer)return;const token=generation;restartTimer=setTimeout(()=>{restartTimer=null;if(listening&&token===generation)startSession()},delay)}
  function stop(){listening=false;generation++;if(restartTimer)clearTimeout(restartTimer);if(sendTimer)clearTimeout(sendTimer);restartTimer=sendTimer=null;if(recognition){const old=recognition;recognition=null;old.onend=old.onerror=old.onresult=null;try{old.stop()}catch{}}showStatus('Dictation stopped.');return{ok:true,message:'Dictation stopped.'}}
  function startSession(){if(!listening)return;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){listening=false;showStatus('Chrome speech recognition is unavailable.');return}const token=generation,instance=new SR();recognition=instance;instance.continuous=true;instance.interimResults=false;instance.lang=navigator.language||'en-US';instance.maxAlternatives=1;
    instance.onresult=e=>{if(!listening||token!==generation)return;for(let i=e.resultIndex;i<e.results.length;i++){if(!e.results[i].isFinal)continue;const transcript=e.results[i][0]?.transcript?.trim();if(!transcript)continue;const el=composer();if(!el){showStatus('Open a Character.AI chat composer.');continue}const old=read(el);setText(el,old?old+' '+transcript:'repeat '+transcript);sendAfterSilence()}};
    instance.onerror=e=>{if(!listening||token!==generation)return;if(e.error==='not-allowed'||e.error==='service-not-allowed'){listening=false;if(sendTimer)clearTimeout(sendTimer);showStatus('Microphone or speech-recognition permission denied. Check Chrome site settings.')}else if(e.error==='network'||e.error==='no-speech'||e.error==='aborted')showStatus('Speech recognition timed out or disconnected; reconnecting…')};
    instance.onend=()=>{if(recognition===instance)recognition=null;if(!listening||token!==generation)return;scheduleRestart(restartDelay);restartDelay=Math.min(Math.round(restartDelay*1.5),5000);showStatus('Chrome recognition ended — automatically restarting…')};
    try{instance.start();restartDelay=500;showStatus('Listening with Chrome speech recognition. Auto-restarts after timeouts.')}catch{if(recognition===instance)recognition=null;scheduleRestart(restartDelay);restartDelay=Math.min(Math.round(restartDelay*1.5),5000);showStatus('Could not start recognition yet; retrying automatically…')}
  }
  async function start(){if(listening)return{ok:true,message:'Already listening; recognition restarts automatically after timeouts.'};if(!composer())return{ok:false,message:'Open a Character.AI chat first.'};if(!(window.SpeechRecognition||window.webkitSpeechRecognition))return{ok:false,message:'Chrome speech recognition is unavailable.'};listening=true;generation++;restartDelay=500;startSession();return{ok:true,message:'Listening. Chrome speech recognition will restart automatically after timeouts.'}}
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{if(msg.action==='START'){start().then(reply);return true}if(msg.action==='STOP'){reply(stop());return true}});
})();