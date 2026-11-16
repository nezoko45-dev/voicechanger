(() => {
  if (window.__caiVoiceLoopInstalled) return;
  window.__caiVoiceLoopInstalled = true;

  const normalizeSvgPath = d => (d || '').trim().replace(/\\s+/g, ' ');
  let recognition = null, listening = false, busy = false, speechQueue = [], lastSentAt = 0, lastSentText = '';
  let generationTimer = null;
  const panel = document.createElement('div');
  panel.id = 'cai-voice-loop-panel';
  panel.innerHTML = '<strong>CAI Voice Loop</strong><button id="cvl-start">🎙 Start</button><button id="cvl-stop" disabled>Stop</button><span id="cvl-status">Ready</span>';
  document.documentElement.appendChild(panel);
  const status = panel.querySelector('#cvl-status');
  const startBtn = panel.querySelector('#cvl-start');
  const stopBtn = panel.querySelector('#cvl-stop');
  const say = t => status.textContent = t;

  function latestComposer() {
    const el = document.querySelector('#chat-input-textarea');
    return el && el.getClientRects().length && !el.disabled ? el : null;
  }
  function setComposer(el, text) {
    if (!el) return false;
    el.focus();
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
    return true;
  }
  function sendText(text) {
    const composer = latestComposer();
    if (!setComposer(composer, text)) { say('Chat input not found'); return false; }
    const form = composer.closest('form');
    if (form?.requestSubmit) form.requestSubmit();
    else composer.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',code:'Enter',bubbles:true}));
    return true;
  }

  // CAI buttons expose stable accessible labels: Play voice / Stop voice.
  function findVoiceButton() {
    return [...document.querySelectorAll('button[aria-label="Play voice"],button[aria-label="Stop voice"]')]
      .find(b => b.getClientRects().length && !b.disabled) || null;
  }
  function voiceIsOn() {
    return !!document.querySelector('button[aria-label="Stop voice"]');
  }
  function setVoice(on) {
    const currentlyOn = voiceIsOn();
    if (currentlyOn === on) return true;
    const button = findVoiceButton();
    if (!button) { say('CAI Play/Stop voice HTML button not found'); return false; }
    button.click();
    return true;
  }
  function ensureVoiceOn() { return setVoice(true); }
  function ensureVoiceOff() { return setVoice(false); }

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
        ensureVoiceOff();
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
    if (ensureVoiceOn()) {
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