(() => {
  if (window.__caiDictationInstalled) return;
  window.__caiDictationInstalled = true;
  let recognition = null, listening = false, restartTimer = null, sendTimer = null;
  const SILENCE_TO_SEND_MS = 1200;
  const selectors = [
    'textarea[placeholder]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
    'textarea'
  ];
  function composer() {
    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)];
      const node = nodes.reverse().find(el => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.disabled && !el.readOnly;
      });
      if (node) return node;
    }
    return null;
  }
  function setComposerText(el, text) {
    el.focus();
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:text}));
    } else {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, text); else el.value = text;
      el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:text}));
      try { el.setSelectionRange(text.length, text.length); } catch {}
    }
    el.dispatchEvent(new Event('change', {bubbles:true}));
  }
  function findSendButton(el) {
    const form = el.closest('form') || el.parentElement?.parentElement?.parentElement;
    const candidates = [...(form || document).querySelectorAll('button')];
    return candidates.find(b => {
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
      const label = [b.getAttribute('aria-label'), b.getAttribute('title'), b.innerText, b.getAttribute('data-testid')].join(' ').toLowerCase();
      return /send|submit|send-message|submit-message/.test(label);
    });
  }
  function sendAfterSilence() {
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      sendTimer = null;
      const el = composer();
      if (!el) { showStatus('Could not find the message box to send.'); return; }
      const content = el.isContentEditable ? el.textContent.trim() : (el.value || '').trim();
      if (!content) return;
      const button = findSendButton(el);
      if (button) {
        button.click();
        showStatus('Silence detected — message sent.');
      } else {
        showStatus('Silence detected, but the Send button was not found. Please send manually.');
      }
    }, SILENCE_TO_SEND_MS);
  }
  function stop() {
    listening = false;
    if (restartTimer) clearTimeout(restartTimer);
    if (sendTimer) clearTimeout(sendTimer);
    restartTimer = sendTimer = null;
    if (recognition) { recognition.onend = null; try { recognition.stop(); } catch {} }
    recognition = null;
    return {ok:true,message:'Dictation stopped.'};
  }
  async function start() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return {ok:false,message:'Speech recognition is unavailable in this Chrome context.'};
    if (!composer()) return {ok:false,message:'I could not find the chat message box. Open a chat and try again.'};
    if (listening) return {ok:true,message:'Already listening. Speak into your microphone.'};
    listening = true;
    function beginSession() {
      if (!listening) return;
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = navigator.language || 'en-US';
      recognition.onresult = event => {
        for (let i=event.resultIndex;i<event.results.length;i++) {
          if (!event.results[i].isFinal) continue;
          const transcript = event.results[i][0]?.transcript?.trim();
          if (!transcript) continue;
          const el = composer();
          if (el) {
            const existing = el.isContentEditable ? el.textContent.trim() : (el.value || '').trim();
            const draft = existing ? existing + ' ' + transcript : 'repeat ' + transcript;
            setComposerText(el, draft);
            sendAfterSilence();
          }
        }
      };
      recognition.onerror = event => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          listening = false;
          if (sendTimer) clearTimeout(sendTimer);
          showStatus('Microphone permission was denied. Allow microphone access in Chrome.');
        }
      };
      recognition.onend = () => {
        recognition = null;
        if (listening) restartTimer = setTimeout(beginSession, 400);
      };
      try { recognition.start(); }
      catch { if (listening) restartTimer = setTimeout(beginSession, 800); }
    }
    beginSession();
    showStatus('Listening. Dictation starts with “repeat” and sends after 1.2 seconds of silence.');
    return {ok:true,message:'Listening. The message will send after 1.2 seconds of silence.'};
  }
  function showStatus(message) {
    let el=document.getElementById('__cai_dictation_status');
    if (!el) {
      el=document.createElement('div'); el.id='__cai_dictation_status';
      Object.assign(el.style,{position:'fixed',zIndex:'2147483647',bottom:'14px',right:'14px',padding:'9px 12px',borderRadius:'10px',background:'#211b2a',color:'#fff',font:'13px system-ui',boxShadow:'0 4px 20px #0005',maxWidth:'320px'});
      document.documentElement.appendChild(el);
    }
    el.textContent='🎙 '+message;
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'START') { start().then(sendResponse); return true; }
    if (msg.action === 'STOP') { sendResponse(stop()); return true; }
  });
})();