(() => {
  if (window.__caiDictationInstalled) return;
  window.__caiDictationInstalled = true;
  let recognition = null, listening = false, restartTimer = null, commandSent = false;
  const COMMAND = "Repeat each word I say exactly as I say it. Do not add commentary, explanations, or extra words. Just repeat my words.";
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
      const selection = window.getSelection();
      if (selection && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        if (!el.contains(range.commonAncestorContainer)) {
          range.selectNodeContents(el); range.collapse(false); selection.removeAllRanges(); selection.addRange(range);
        }
      }
      document.execCommand('insertText', false, text);
      if (!el.textContent.includes(text)) el.textContent = (el.textContent || '') + text;
    } else {
      const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
      const before = el.value.slice(0, start), after = el.value.slice(end);
      const spacer = before && !/\s$/.test(before) ? ' ' : '';
      const next = before + spacer + text + after;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, next); else el.value = next;
      el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:text}));
      const pos = (before + spacer + text).length;
      try { el.setSelectionRange(pos,pos); } catch {}
    }
    el.dispatchEvent(new Event('change', {bubbles:true}));
  }
  function findSendButton(el) {
    const form = el.closest('form') || el.parentElement?.parentElement?.parentElement;
    const candidates = [...(form || document).querySelectorAll('button')];
    return candidates.find(b => {
      const label = [b.getAttribute('aria-label'), b.getAttribute('title'), b.innerText].join(' ').toLowerCase();
      return !b.disabled && (/send|submit|message/.test(label) || b.querySelector('svg'));
    });
  }
  async function sendCommandOnce() {
    if (commandSent) return true;
    const el = composer();
    if (!el) return false;
    setComposerText(el, COMMAND);
    await new Promise(r => setTimeout(r, 350));
    const button = findSendButton(el);
    if (button) button.click();
    else el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));
    commandSent = true;
    return true;
  }
  function stop() {
    listening = false;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    if (recognition) { recognition.onend = null; try { recognition.stop(); } catch {} }
    recognition = null;
    return {ok:true,message:'Dictation stopped.'};
  }
  async function start() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return {ok:false,message:'Speech recognition is unavailable in this Chrome context.'};
    if (!composer()) return {ok:false,message:'I could not find the chat message box. Open a chat and try again.'};
    const sent = await sendCommandOnce();
    if (!sent) return {ok:false,message:'Could not place the repeat instruction in the chat.'};
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
          if (el) setComposerText(el, transcript);
        }
      };
      recognition.onerror = event => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          listening = false;
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
    showStatus('Listening. Speak normally; recognized phrases are inserted into the message box, not auto-sent.');
    return {ok:true,message:'Listening. The repeat instruction was sent once.'};
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
