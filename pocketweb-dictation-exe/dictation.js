(() => {
  let recognition = null;
  let stream = null;
  let audioContext = null;
  let analyser = null;
  let frame = 0;
  let running = false;
  let busy = false;
  let finalText = "";
  let lastVoiceAt = 0;
  let heardVoice = false;
  let restarting = false;
  const SILENCE_MS = 2500;
  const THRESHOLD = 0.018;

  function status(message) {
    window.__pwDictationStatus = "PocketWeb Dictation: " + message;
  }
  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }
  function findBox() {
    const all = [...document.querySelectorAll("textarea,input:not([type]),input[type=text],[contenteditable=true],[role=textbox]")];
    return all.find(el => visible(el) && !el.disabled && !el.readOnly);
  }
  function findGenerate() {
    return [...document.querySelectorAll("button,[role=button],input[type=button],input[type=submit]")]
      .filter(visible).find(el => {
        const label = (el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || "").trim().toLowerCase();
        return label.includes("generate speech") || label === "generate" || label.includes("generate audio");
      });
  }
  function enterText(el, text) {
    el.focus();
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") el.textContent = text;
    else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text); else el.value = text;
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function startRecognition() {
    if (!running || busy || recognition || restarting) return;
    const API = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!API) { status("Chrome SpeechRecognition is unavailable."); return; }
    try {
      const rec = new API();
      recognition = rec;
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = event => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            const phrase = event.results[i][0].transcript.trim();
            if (phrase) finalText = (finalText + " " + phrase).trim();
          }
        }
      };
      rec.onerror = event => {
        if (event.error !== "no-speech" && event.error !== "aborted") status("Speech recognition: " + event.error);
      };
      rec.onend = () => {
        if (recognition === rec) recognition = null;
        if (running && !busy) {
          restarting = true;
          setTimeout(() => { restarting = false; startRecognition(); }, 300);
        }
      };
      rec.start();
      status("Listening… speak into your microphone.");
    } catch (e) {
      recognition = null;
      status("Could not start speech recognition: " + e.message);
      setTimeout(startRecognition, 1200);
    }
  }
  async function generatePhrase() {
    if (!running || busy || !finalText.trim()) return;
    const phrase = finalText.trim();
    finalText = "";
    busy = true;
    if (recognition) {
      const old = recognition;
      recognition = null;
      try { old.stop(); } catch {}
    }
    try {
      const box = findBox();
      const button = findGenerate();
      if (!box || !button) throw new Error("Could not locate PocketWebTools text box or Generate button.");
      enterText(box, phrase);
      await new Promise(resolve => setTimeout(resolve, 150));
      if (button.disabled) throw new Error("Generate button is disabled. Check the text box and page state.");
      button.click();
      status("Submitted: " + phrase.slice(0, 90));
    } catch (e) {
      status(e.message || "Could not submit transcript.");
    }
    await new Promise(resolve => setTimeout(resolve, 900));
    busy = false;
    if (running) startRecognition();
  }
  function meter() {
    if (!running || !analyser) return;
    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const v = (sample - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / samples.length);
    const now = Date.now();
    if (rms > THRESHOLD) {
      lastVoiceAt = now;
      heardVoice = true;
    } else if (heardVoice && now - lastVoiceAt >= SILENCE_MS && finalText.trim() && !busy) {
      heardVoice = false;
      generatePhrase();
    }
    frame = requestAnimationFrame(meter);
  }
  window.__pwDictationStart = async () => {
    if (running) return "Already listening.";
    running = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is unavailable in this tab.");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      lastVoiceAt = Date.now();
      frame = requestAnimationFrame(meter);
      startRecognition();
      return "Microphone connected. Listening…";
    } catch (e) {
      running = false;
      status("Microphone error: " + e.message + " Allow microphone access for pocketweb.tools in Chrome.");
      return window.__pwDictationStatus;
    }
  };
  window.__pwDictationStop = () => {
    running = false;
    cancelAnimationFrame(frame);
    if (recognition) { try { recognition.stop(); } catch {} recognition = null; }
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    if (audioContext) audioContext.close().catch(() => {});
    audioContext = null;
    analyser = null;
    finalText = "";
    busy = false;
    status("Stopped.");
    return "Stopped.";
  };
  status("Ready.");
})();