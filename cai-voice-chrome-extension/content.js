(() => {
  if (window.__caiVoiceLoopInstalled) return;
  window.__caiVoiceLoopInstalled = true;

  const PLAY_PATH = 'M9.576 2.534C7.578 1.299 5 2.737 5 5.086v13.828c0 2.35 2.578 3.787 4.576 2.552l11.194-6.914c1.899-1.172 1.899-3.932 0-5.104z';
  const normalizeSvgPath = d => (d || '').trim().replace(/\s+/g, ' ');
  const isCaiPlayTriangle = path => normalizeSvgPath(path.getAttribute('d')) === normalizeSvgPath(PLAY_PATH);
  let recognition = null, listening = false, busy = false, lastReplyText = '', speechQueue = [], lastSentAt = 0, lastSentText = '';
  let generationTimer = null, generationStarted = false;
  const panel = document.createElement('div');
  panel.id = 'cai-voice-loop-panel';
  panel.innerHTML = '<strong>CAI Voice Loop</strong><button id="cvl-start">🎙 Start</button><button id="cvl-stop" disabled>Stop</button><span id="cvl-status">Ready</span>';
  document.documentElement.appendChild(panel);
  const status = panel.querySelector('#cvl-status');
  const startBtn = panel.querySelector('#cvl-start');
  const stopBtn = panel.querySelector('#cvl-stop');
  const say = t => status.textContent = t;

  // Verified directly from the user's CAI outerHTML.
  function latestComposer() {
    const el = document.querySelector('#chat-input-textarea');
    return el && el.getClientRects().length && !el.disabled ? el : null;
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
    // Submit through the textbox's actual form when available; CAI handles React state.
    const form = composer.closest('form');
    if (form) {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}));
    } else {
      composer.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',code:'Enter',bubbles:true}));
      composer.dispatchEvent(new KeyboardEvent('keypress', {key:'Enter',code:'Enter',bubbles:true}));
      composer.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter',code:'Enter',bubbles:true}));
    }
    return true;
  }
  const VOICE_WAVE_PATH = 'M8 4v16M4 10v4m8-6v8m4-10v12m4-8v4';
  function findVoiceButton() {
    // Match the exact voice-wave SVG path supplied by the user.
    return [...document.querySelectorAll('button')].find(btn =>
      btn.getClientRects().length && !btn.disabled &&
      [...btn.querySelectorAll('svg path')].some(path =>
        normalizeSvgPath(path.getAttribute('d')) === VOICE_WAVE_PATH
      )
    ) || null;
  }
  function findStopGeneratingButton() {
    return [...document.querySelectorAll('button')].find(btn => {
      if (!btn.getClientRects().length) return false;
      const label = ((btn.getAttribute('aria-label') || '') + ' ' + (btn.title || '') + ' ' + (btn.innerText || '')).trim();
      return /stop generating|stop generation|interrupt generation/i.test(label);
    }) || null;
  }
  function findCaiAudio() {
    return [...document.querySelectorAll('audio')].filter(a => a.currentSrc || a.src || a.readyState > 0).at(-1) || null;
  }
  function waitForReplyAudioToFinish() {
    say('Waiting for CAI reply audio to finish…');
    let audio = null, sawAudio = false, noAudioTicks = 0, elapsed = 0;
    clearInterval(generationTimer);
    generationTimer = setInterval(() => {
      elapsed += 250;
      const stop = findStopGeneratingButton();
      const candidate = findCaiAudio();
      if (candidate && candidate !== audio) {
        audio = candidate;
        sawAudio = false;
      }
      if (audio && !audio.paused && !audio.ended) {
        sawAudio = true;
        noAudioTicks = 0;
        say('CAI is speaking… Voice stays ON');
      } else if (sawAudio && (!audio || audio.paused || audio.ended)) {
        clearInterval(generationTimer); generationTimer = null;
        clickVoiceToggle();
        say('CAI audio finished • Voice OFF');
        busy = false; processSpeechQueue();
      } else if (stop) {
        // Generation is still active. Do NOT turn Voice off.
        say('CAI generating… Voice stays ON');
        noAudioTicks = 0;
      } else if (!stop && !sawAudio) {
        // Wait for generation completion and audio element/playback to appear.
        noAudioTicks++;
        if (noAudioTicks >= 12 && elapsed > 5000) {
          clearInterval(generationTimer); generationTimer = null;
          say('Reply ended without detectable audio; Voice left ON');
          busy = false; processSpeechQueue();
        }
      }
      if (elapsed > 180000) {
        clearInterval(generationTimer); generationTimer = null;
        say('Audio wait timeout; Voice left ON');
        busy = false; processSpeechQueue();
      }
    }, 250);
  }
  function clickVoiceToggle() {
    const button = findVoiceButton();
    if (!button) { say('CAI Voice button not found'); return false; }
    button.click();
    return true;
  }
  function beginVoiceForReply() {
    if (clickVoiceToggle()) {
      say('Voice enabled • waiting for CAI reply audio');
      waitForReplyAudioToFinish();
    }
  }
  function processSpeechQueue() {
    if (busy || !speechQueue.length || !listening) return;
    const text = speechQueue.shift();
    busy = true;
    say('Sending: ' + text + (speechQueue.length ? ' • queued ' + speechQueue.length : ''));
    if (sendText(text)) beginVoiceForReply(); else { busy = false; processSpeechQueue(); }
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
      // Always submit each finalized recognition result; never block mic input on reply detection.
      const now = Date.now();
      if (text === lastSentText && now - lastSentAt < 1800) return; // guard duplicate final event
      lastSentText = text; lastSentAt = now;
      // Queue speech while CAI is talking; don't toggle Voice off mid-reply.
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