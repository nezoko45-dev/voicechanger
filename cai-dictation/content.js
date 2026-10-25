(() => {
  if (window.__caiDictationInstalled) return;
  window.__caiDictationInstalled = true;
  const SILENCE_TO_SEND_MS=1200;
  let recognition=null,listening=false,restartTimer=null,sendTimer=null,restartDelay=500,generation=0;
  const selectors=['textarea[placeholder]','[contenteditable="true"][role="textbox"]','[contenteditable="true"]','textarea','input[type="text"]'];
  function composer(){
    const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!e.disabled&&!e.readOnly};
    const all=[...new Set(selectors.flatMap(sel=>[...document.querySelectorAll(sel)]))].filter(visible);
    const meta=e=>[e.getAttribute('placeholder'),e.getAttribute('aria-label'),e.getAttribute('data-placeholder'),e.getAttribute('name'),e.getAttribute('data-testid')].join(' ').toLowerCase();
    // Prefer the actual chat/message composer, never a comment box or comment editor.
    const isComment=e=>/comment|write a comment|add a comment|post comment/i.test(meta(e)+' '+(e.closest('form')?.innerText||'').slice(0,160).toLowerCase());
    const isChat=e=>/(message|chat|say something|type here|send a message|talk|reply to character|enter message)/i.test(meta(e));
    const preferred=all.filter(e=>!isComment(e)&&isChat(e)).sort((a,b)=>{
      const score=e=>(e.isContentEditable?2:0)+(e.getAttribute('role')==='textbox'?2:0)+(/message|chat|say something|send a message/i.test(meta(e))?5:0);
      return score(b)-score(a);
    });
    if(preferred.length)return preferred[0];
    // Fallback only to a visible composer-like element, excluding comment fields.
    const fallback=all.filter(e=>!isComment(e)&&!/(search|filter|comment|username|email|password)/i.test(meta(e)));
    return fallback.length?fallback[fallback.length-1]:null;
  }
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
    let finished=false,observer=null,timeout=null,checkTimer=null;
    let candidate=null,lastReplyText='',stableSince=0;
    const cleanup=()=>{if(observer)observer.disconnect();if(timeout)clearTimeout(timeout);if(checkTimer)clearTimeout(checkTimer)};
    function replyRegion(button){
      let node=button;
      for(let i=0;i<8&&node.parentElement;i++){
        node=node.parentElement;
        const text=(node.innerText||node.textContent||'').replace(/\\s+/g,' ').trim();
        if(/voice recorder/i.test(text)&&node.querySelectorAll('button,[role="button"]').length>=1)return node;
      }
      return button.parentElement||button;
    }
    function generationStillActive(button){
      const region=replyRegion(button);
      const text=(region.innerText||region.textContent||'').replace(/\\s+/g,' ').trim();
      // Character.AI often shows a "..." placeholder and a retry/refresh control while composing.
      const body=text.replace(/voice recorder/ig,'').replace(/c\\.ai/ig,'').trim();
      if(!body||/^(?:[.\\u2026\\u22ef\\s]|loading|thinking)+$/i.test(body))return true;
      if(/(?:^|\\s)(?:\\.{3,}|\\u2026|\\u22ef)(?:\\s|$)/.test(body)&&body.replace(/[.\\u2026\\u22ef\\s]/g,'').length<4)return true;
      const controls=[...region.querySelectorAll('button,[role="button"]')];
      if(controls.some(btn=>{
        const label=[btn.getAttribute('aria-label'),btn.getAttribute('title'),btn.getAttribute('data-testid')].join(' ').toLowerCase();
        return /stop generating|stop response|stop generation|cancel response|regenerate|retry|refresh|loading/.test(label);
      }))return true;
      // Also catch an unlabeled refresh/retry icon while the placeholder is still visible.
      if(/^(?:[.\\u2026\\u22ef\\s]|loading|thinking)+$/i.test(body)&&controls.length>1)return true;
      return false;
    }
    function replyText(button){
      const region=replyRegion(button);
      return (region.innerText||region.textContent||'').replace(/\\s+/g,' ').trim();
    }
    const checkReady=()=>{
      if(finished)return;
      if(!candidate||!candidate.isConnected){
        candidate=replyPlayButtons().find(button=>!previous.has(button))||null;
        lastReplyText='';stableSince=0;
      }
      if(!candidate){checkTimer=setTimeout(checkReady,500);return}
      const currentText=replyText(candidate);
      if(currentText!==lastReplyText){lastReplyText=currentText;stableSince=Date.now()}
      const stableLongEnough=stableSince>0&&Date.now()-stableSince>=2500;
      if(!generationStillActive(candidate)&&stableLongEnough){
        finished=true;cleanup();
        setTimeout(()=>{
          if(candidate.isConnected){candidate.click();showStatus("Reply finished generating — clicked its blue audio play button.")}
        },200);
        return;
      }
      checkTimer=setTimeout(checkReady,500);
    };
    observer=new MutationObserver(()=>{if(!candidate||!candidate.isConnected)candidate=replyPlayButtons().find(button=>!previous.has(button))||null});
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true});
    timeout=setTimeout(()=>{if(finished)return;finished=true;cleanup();showStatus("Message sent, but couldn't confirm generation finished or find the reply play button.")},120000);
    send.click();
    showStatus("Message sent — waiting for the reply to finish generating before playing audio…");
    checkTimer=setTimeout(checkReady,400);
  }
  function sendAfterSilence(){if(sendTimer)clearTimeout(sendTimer);sendTimer=setTimeout(()=>{sendTimer=null;const el=composer();if(!el||!read(el))return;sendAndPlayReply(el)},SILENCE_TO_SEND_MS)}
  function showStatus(message){let el=document.getElementById('__cai_dictation_status');if(!el){el=document.createElement('div');el.id='__cai_dictation_status';Object.assign(el.style,{position:'fixed',zIndex:'2147483647',bottom:'14px',right:'14px',padding:'9px 12px',borderRadius:'10px',background:'#211b2a',color:'#fff',font:'13px system-ui',boxShadow:'0 4px 20px #0005',maxWidth:'360px'});document.documentElement.appendChild(el)}el.textContent='🎙 '+message}
  function scheduleRestart(delay){if(!listening||restartTimer)return;const token=generation;restartTimer=setTimeout(()=>{restartTimer=null;if(listening&&token===generation)startSession()},delay)}
  function stop(){listening=false;generation++;if(restartTimer)clearTimeout(restartTimer);if(sendTimer)clearTimeout(sendTimer);restartTimer=sendTimer=null;if(recognition){const old=recognition;recognition=null;old.onend=old.onerror=old.onresult=null;try{old.stop()}catch{}}showStatus('Dictation stopped.');return{ok:true,message:'Dictation stopped.'}}
  function startSession(){if(!listening)return;const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){listening=false;showStatus('Chrome speech recognition is unavailable.');return}const token=generation,instance=new SR();recognition=instance;instance.continuous=true;instance.interimResults=false;instance.lang=navigator.language||'en-US';instance.maxAlternatives=1;
    instance.onresult=e=>{if(!listening||token!==generation)return;for(let i=e.resultIndex;i<e.results.length;i++){if(!e.results[i].isFinal)continue;const transcript=e.results[i][0]?.transcript?.trim();if(!transcript)continue;const el=composer();if(!el){showStatus('Open a Talkie or Character.AI chat composer.');continue}const old=read(el);setText(el,old?old+' '+transcript:'repeat '+transcript);sendAfterSilence()}};
    instance.onerror=e=>{if(!listening||token!==generation)return;if(e.error==='not-allowed'||e.error==='service-not-allowed'){listening=false;if(sendTimer)clearTimeout(sendTimer);showStatus('Microphone or speech-recognition permission denied. Check Chrome site settings.')}else if(e.error==='network'||e.error==='no-speech'||e.error==='aborted')showStatus('Speech recognition timed out or disconnected; reconnecting…')};
    instance.onend=()=>{if(recognition===instance)recognition=null;if(!listening||token!==generation)return;scheduleRestart(restartDelay);restartDelay=Math.min(Math.round(restartDelay*1.5),5000);showStatus('Chrome recognition ended — automatically restarting…')};
    try{instance.start();restartDelay=500;showStatus('Listening with Chrome speech recognition. Auto-restarts after timeouts.')}catch{if(recognition===instance)recognition=null;scheduleRestart(restartDelay);restartDelay=Math.min(Math.round(restartDelay*1.5),5000);showStatus('Could not start recognition yet; retrying automatically…')}
  }
  async function start(){if(listening)return{ok:true,message:'Already listening; recognition restarts automatically after timeouts.'};if(!composer())return{ok:false,message:'Open a Talkie or Character.AI chat first.'};if(!(window.SpeechRecognition||window.webkitSpeechRecognition))return{ok:false,message:'Chrome speech recognition is unavailable.'};listening=true;generation++;restartDelay=500;startSession();return{ok:true,message:'Listening. Chrome speech recognition will restart automatically after timeouts.'}}
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{if(msg.action==='START'){start().then(reply);return true}if(msg.action==='STOP'){reply(stop());return true}});
})();