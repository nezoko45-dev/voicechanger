(() => {
  if (window.__caiVoiceLoopInstalled) return;
  window.__caiVoiceLoopInstalled = true;

  const PLAY_PATH = 'M9.576 2.534C7.578 1.299 5 2.737 5 5.086v13.828c0 2.35 2.578 3.787 4.576 2.552l11.194-6.914c1.899-1.172 1.899-3.932 0-5.104z';
  const normalizeSvgPath = d => (d || '').trim().replace(/\s+/g, ' ');
  const isCaiPlayTriangle = path => normalizeSvgPath(path.getAttribute('d')) === normalizeSvgPath(PLAY_PATH);
  let recognition = null, listening = false, busy = false, lastReplyText = '', speechQueue = [];
  let generationTimer = null, generationStarted = false;
  const panel = document.createElement('div');
  panel.id = 'cai-voice-loop-panel';
  panel.innerHTML = '<strong>CAI Voice Loop</strong><button id="cvl-start">🎙 Start</button><button id="cvl-stop" disabled>Stop</button><span id="cvl-status">Ready</span>';
  document.documentElement.appendChild(panel);
  const status = panel.querySelector('#cvl-status');
  const startBtn = panel.querySelector('#cvl-start');
  const stopBtn = panel.querySelector('#cvl-stop');
  const say = t => status.textContent = t;

  function latestComposer() {
    return [...document.querySelectorAll('textarea, input[placeholder], [contenteditable="true"]')]
      .filter(el => el.getClientRects().length && !el.closest('#cai-voice-loop-panel'))
      .at(-1);
  }
  function setComposer(el, text) {
    if (!el) return false;
    el.focus();
    if (el.isContentEditable) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:text}));
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
    }
    return true;
  }
  function sendText(text) {
    const composer = latestComposer();
    if (!setComposer(composer, text)) { say('Chat input not found'); return false; }
    composer.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',code:'Enter',bubbles:true}));
    composer.dispatchEvent(new KeyboardEvent('keypress', {key:'Enter',code:'Enter',bubbles:true}));
    composer.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter',code:'Enter',bubbles:true}));
    // fallback: click the enabled send button if Enter did not submit
    setTimeout(() => {
      const send = [...document.querySelectorAll('button')].find(b => b.getClientRects().length && !b.disabled &&
        /send/i.test((b.getAttribute('aria-label')||'')+' '+(b.title||'')));
      if (send && (composer.value || composer.textContent || '').trim()) send.click();
    }, 250);
    return true;
  }
  function getReplyBlocks() {
    // Character.AI message turns commonly expose message/assistant containers; exclude our overlay.
    return [...document.querySelectorAll('[data-message-author-role="assistant"], [class*="message" i], [class*="Message"]')]
      .filter(el => el.getClientRects().length && !el.closest('#cai-voice-loop-panel') && el.innerText?.trim());
  }
  function newestPlayButton() {
    // Anchor on the exact CAI play-triangle SVG supplied by the user; don't rely on guessed labels/classes.
    const candidates = [...document.querySelectorAll('button')].filter(btn =>
      btn.getClientRects().length && !btn.disabled &&
      [...btn.querySelectorAll('svg path')].some(isCaiPlayTriangle));
    return candidates.at(-1) || null;
  }
  function activatePlayButton(btn) {
    if (!btn) return false;
    btn.scrollIntoView({block:'center', inline:'nearest'});
    btn.focus({preventScroll:true});
    const opts = {bubbles:true, cancelable:true, view:window, button:0};
    btn.dispatchEvent(new PointerEvent('pointerdown', {...opts, pointerId:1, pointerType:'mouse', isPrimary:true}));
    btn.dispatchEvent(new MouseEvent('mousedown', opts));
    btn.dispatchEvent(new PointerEvent('pointerup', {...opts, pointerId:1, pointerType:'mouse', isPrimary:true}));
    btn.dispatchEvent(new MouseEvent('mouseup', opts));
    btn.click();
    return true;
  }
  function waitForReplyAndPlay() {
    generationStarted = true;
    say('Waiting for CAI reply…');
    let previous = '', stable = 0, elapsed = 0;
    clearInterval(generationTimer);
    generationTimer = setInterval(() => {
      elapsed += 500;
      const blocks = getReplyBlocks();
      const text = blocks.at(-1)?.innerText?.trim() || '';
      const stopPresent = [...document.querySelectorAll('button')].some(b => /stop|interrupt/i.test((b.getAttribute('aria-label')||'')+' '+b.title));
      if (text && text === previous && !stopPresent) stable += 1; else stable = 0;
      previous = text;
      if (stable >= 3 && text && text !== lastReplyText) {
        clearInterval(generationTimer); generationTimer = null;
        lastReplyText = text;
        setTimeout(() => {
          const play = newestPlayButton();
          if (play && activatePlayButton(play)) { say('Clicked Play voice • waiting for audio'); setTimeout(() => { if (play.getAttribute('aria-label') === 'Play voice') say('Click sent; CAI did not switch button state'); }, 1200); }
          else say('Reply ready (play button not found)');
          busy = false; generationStarted = false; processSpeechQueue();
        }, 350);
      } else if (elapsed > 90000) {
        clearInterval(generationTimer); generationTimer = null; busy = false; generationStarted = false; say('Reply timeout'); processSpeechQueue();
      }
    }, 500);
  }
  function processSpeechQueue() {
    if (busy || !speechQueue.length || !listening) return;
    const text = speechQueue.shift();
    busy = true;
    say('Sending: ' + text + (speechQueue.length ? ' • queued ' + speechQueue.length : ''));
    if (sendText(text)) waitForReplyAndPlay(); else { busy = false; processSpeechQueue(); }
  }
  function start() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { say('Speech recognition unavailable in this Chrome'); return; }
    recognition = new SR();
    recognition.lang = 'en-US'; recognition.continuous = true; recognition.interimResults = false;
    recognition.onstart = () => { listening = true; startBtn.disabled = true; stopBtn.disabled = false; say('Listening… speak a message'); };
    recognition.onerror = e => say('Mic/STT: ' + e.error);
    recognition.onend = () => { if (listening) { try { recognition.start(); } catch {} } };
    recognition.onresult = e => {
      const result = e.results[e.results.length - 1];
      if (!result.isFinal) return;
      const text = result[0].transcript.trim();
      if (!text) return;
      // Queue speech instead of silently discarding it while CAI is generating.
      speechQueue.push(text);
      processSpeechQueue();
    };
    try { recognition.start(); } catch (e) { say('Could not start microphone: ' + e.message); }
  }
  function stop() {
    listening = false; busy = false; speechQueue = []; clearInterval(generationTimer); generationTimer = null;
    try { recognition?.stop(); } catch {}
    startBtn.disabled = false; stopBtn.disabled = true; say('Stopped');
  }
  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
})();