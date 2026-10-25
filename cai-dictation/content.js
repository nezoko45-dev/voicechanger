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
  function sendAfterSilence(){if(sendTimer)clearTimeout(sendTimer);sendTimer=setTimeout(()=>{sendTimer=null;const el=composer();if(!el||!read(el))return;const btn=sendButton(el);if(btn){btn.click();showStatus('Silence detected — message sent.')}else showStatus('Silence detected, but Send was not found. Please send manually.')},SILENCE_TO_SEND_MS)}
  function showStatus(message){let el=document.getElementById('__cai_dictation_status');if(!el){el=document.createElement('div');el.id='__cai_dictation_status';Object.assign(el.style,{position:'fixed',zIndex:'2147483647',bottom:'14px',right:'14px',padding:'9px 12px',borderRadius:'10px',background:'#211b2a',color:'#fff',font:'13px system-ui',boxShadow:'0 4px 20px #0005',maxWidth:'360px'});document.documentElement.appendChild(el)}el.textContent='🎙 '+message}
  // Recover Character.AI reply voice playback if its play control fails to start audio.
  let voiceRecoveryTimer=null,voiceRecoveryGeneration=0;
  function voiceButtonFrom(target){
    const btn=target instanceof Element?target.closest('button,[role="button"]'):null;
    if(!btn)return null;
    const label=[btn.getAttribute('aria-label'),btn.getAttribute('title'),btn.getAttribute('data-testid'),btn.innerText,btn.textContent].join(' ').toLowerCase();
    if(!/(play|pause|audio|voice|listen|speaker|sound)/i.test(label))return null;
    // Avoid unrelated controls such as video, site-wide audio settings, and call controls.
    if(/video|call|microphone|mic|mute|unmute|sound settings|voice settings/i.test(label))return null;
    return btn;
  }
  function buttonLooksPlaying(btn){
    const label=[btn.getAttribute('aria-label'),btn.getAttribute('title'),btn.getAttribute('data-testid'),btn.innerText,btn.textContent].join(' ').toLowerCase();
    return /pause|stop audio|playing|stop playback/i.test(label)||btn.getAttribute('aria-pressed')==='true';
  }
  function hasActiveMedia(){
    return [...document.querySelectorAll('audio,video')].some(m=>!m.paused&&!m.ended&&m.currentTime>0);
  }
  document.addEventListener('click',event=>{
    const btn=voiceButtonFrom(event.target);
    if(!btn)return;
    const label=[btn.getAttribute('aria-label'),btn.getAttribute('title'),btn.getAttribute('data-testid'),btn.innerText,btn.textContent].join(' ').toLowerCase();
    // Only watch controls that appear to play an individual reply, not generic settings.
    if(!/play|pause|audio|listen|speaker/i.test(label))return;
    if(voiceRecoveryTimer)clearTimeout(voiceRecoveryTimer);
    const attempt=++voiceRecoveryGeneration;
    voiceRecoveryTimer=setTimeout(()=>{
      voiceRecoveryTimer=null;
      if(attempt!==voiceRecoveryGeneration||!btn.isConnected||hasActiveMedia())return;
      if(buttonLooksPlaying(btn)){
        // It looks stuck "on": toggle off, then back on once.
        btn.click();
        setTimeout(()=>{
          if(attempt===voiceRecoveryGeneration&&btn.isConnected&&!hasActiveMedia())btn.click();
        },350);
        showStatus('Character.AI voice playback looks stuck — toggling it off and back on…');
      }else{
        // It never visibly entered playback; retry the play control once.
        btn.click();
        showStatus('Character.AI voice did not start — retrying playback once…');
      }
    },2200);
  },true);
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