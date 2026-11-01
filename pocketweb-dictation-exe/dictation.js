(() => {
  let recognition = null;
  let running = false;
  let busy = false;
  let finalText = "";
  let lastVoiceAt = 0;
  let restarting = false;
  let starting = false;
  let localMode = false;
  let localSetupDone = false;
  let silenceTimer = 0;
  const SILENCE_MS = 2500;

  function status(message) {
    window.__pwDictationStatus = "PocketWeb Dictation: " + message;
  }
  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }
  function fieldDescription(el) {
    return [el.placeholder, el.getAttribute("aria-label"), el.name, el.id,
      el.getAttribute("data-testid"), el.closest("label")?.innerText,
      el.parentElement?.innerText].filter(Boolean).join(" ").toLowerCase();
  }
  function findBox() {
    const all = [...document.querySelectorAll("textarea,input:not([type]),input[type=text],[contenteditable=true],[role=textbox]")]
      .filter(el => visible(el) && !el.disabled && !el.readOnly);
    if (!all.length) return null;
    // PocketWebTools can have several inputs (reference audio, search, etc.).
    // Prefer a multiline/text composer and labels that describe speech text.
    const score = el => {
      const d = fieldDescription(el);
      let n = el.tagName === "TEXTAREA" ? 100 : 0;
      if (el.isContentEditable || el.getAttribute("contenteditable") === "true") n += 70;
      if (/text to speak|speech text|enter text|type text|text input|script|content/.test(d)) n += 80;
      if (/reference|voice name|search|url|file|email|password/.test(d)) n -= 100;
      if (el.maxLength > 500 || el.rows > 1) n += 15;
      return n;
    };
    return all.sort((a, b) => score(b) - score(a))[0];
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
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      el.textContent = text;
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text); else el.value = text;
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function armSilenceSubmit() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (running && !busy && finalText.trim() && Date.now() - lastVoiceAt >= SILENCE_MS) {
        generatePhrase();
      }
    }, SILENCE_MS + 100);
  }
  async function prepareRecognition(API) {
    if (localSetupDone) return;
    localSetupDone = true;
    if (typeof API.available !== "function" || typeof API.install !== "function") {
      localMode = false;
      status("On-device recognition is not supported by this Chrome build; using Chrome's online speech service.");
      return;
    }
    try {
      status("Checking for offline English speech recognition…");
      const options = { langs: ["en-US"], processLocally: true, quality: "dictation" };
      let availability = await API.available(options);
      if (availability === "available") {
        localMode = true;
        status("Offline English speech recognition is ready.");
        return;
      }
      if (availability === "downloadable" || availability === "downloading") {
        status("Installing Chrome's offline English speech pack…");
        const installed = await API.install(options);
        if (installed) {
          localMode = true;
          status("Offline English speech pack installed. Starting local recognition…");
          return;
        }
        localMode = false;
        localSetupDone = false;
        throw new Error("Chrome could not install the offline English speech pack.");
      }
      localMode = false;
      status("Offline English speech recognition is unavailable; using Chrome's online service.");
    } catch (e) {
      localMode = false;
      localSetupDone = false;
      status("Offline speech setup failed: " + (e.message || e) + ". Online recognition may show a network error.");
    }
  }
  async function startRecognition() {
    if (!running || busy || recognition || restarting || starting) return;
    const API = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!API) { status("Chrome SpeechRecognition is unavailable."); return; }
    starting = true;
    try {
      await prepareRecognition(API);
      if (!running || busy || recognition) return;
      const rec = new API();
      recognition = rec;
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      if ("processLocally" in rec) rec.processLocally = localMode;
      rec.onresult = event => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const phrase = (event.results[i][0]?.transcript || "").trim();
          if (!phrase) continue;
          lastVoiceAt = Date.now();
          if (event.results[i].isFinal) {
            finalText = (finalText + " " + phrase).trim();
            status("Recognized: " + finalText.slice(-100));
          } else {
            interim = phrase;
            status("Hearing: " + interim.slice(0, 80));
          }
        }
        if (finalText.trim()) armSilenceSubmit();
      };
      rec.onspeechend = () => {
        // Chrome detected that the user stopped speaking. Submit after a short quiet gap.
        lastVoiceAt = Date.now();
        if (finalText.trim()) armSilenceSubmit();
      };
      rec.onsoundend = () => {
        // Chrome reports that the microphone input has gone quiet.
        if (finalText.trim()) armSilenceSubmit();
      };
      rec.onerror = event => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          status("Chrome blocked speech recognition. Allow microphone and speech permissions for pocketweb.tools.");
        } else if (event.error === "network") {
          status(localMode
            ? "Offline speech recognition reported a network error. Check Chrome's offline English speech pack, then restart dictation."
            : "Speech service network error. Checking offline recognition on restart; verify internet/VPN/firewall if offline speech is unavailable.");
        } else if (event.error === "language-not-supported") {
          localMode = false;
          localSetupDone = false;
          status("Offline English language pack is unavailable. Restart dictation to retry setup.");
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          status("Speech recognition error: " + event.error);
        }
      };
      rec.onend = () => {
        if (recognition === rec) recognition = null;
        if (running && !busy) {
          restarting = true;
          setTimeout(() => { restarting = false; startRecognition(); }, 900);
        }
      };
      rec.start();
      status(localMode ? "Listening offline… speak into your microphone." : "Listening… speak into your microphone.");
    } catch (e) {
      recognition = null;
      status("Could not start speech recognition: " + (e.message || e));
      setTimeout(() => startRecognition(), 1800);
    } finally {
      starting = false;
    }
  }
  async function generatePhrase() {
    if (!running || busy || !finalText.trim()) return;
    const phrase = finalText.trim();
    finalText = "";
    clearTimeout(silenceTimer);
    busy = true;
    if (recognition) {
      const old = recognition;
      recognition = null;
      try { old.stop(); } catch {}
    }
    try {
      const box = findBox();
      const button = findGenerate();
      if (!box) throw new Error("Speech recognized, but the TTS text-to-speak field was not found. Click the text field once and retry.");
      if (!button) throw new Error("Speech recognized, but the Generate Speech button was not found.");
      enterText(box, phrase);
      await new Promise(resolve => setTimeout(resolve, 250));
      if (button.disabled) throw new Error("Text entered, but Generate is disabled. Check the PocketWebTools page.");
      button.click();
      status("Submitted to TTS box: " + phrase.slice(0, 85));
    } catch (e) {
      // Keep the transcript visible in status instead of silently discarding it.
      status((e.message || "Could not submit transcript.") + " Transcript: " + phrase.slice(0, 100));
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
    busy = false;
    lastVoiceAt = Date.now();
    if (running) startRecognition();
  }
  window.__pwDictationStart = async () => {
    if (running) return "Already listening.";
    running = true;
    try {
      // SpeechRecognition owns microphone capture and reports speechend/soundend.
      // No Web Audio analyser, RMS threshold, or second microphone stream is used.
      lastVoiceAt = Date.now();
      await startRecognition();
      return "Speech recognition started. Listening for speech and silence…";
    } catch (e) {
      running = false;
      status("Microphone error: " + e.message + " Allow microphone access for pocketweb.tools in Chrome.");
      return window.__pwDictationStatus;
    }
  };
  window.__pwDictationStop = () => {
    running = false;
    clearTimeout(silenceTimer);
    if (recognition) { try { recognition.stop(); } catch {} recognition = null; }
    finalText = "";
    busy = false;
    status("Stopped.");
    return "Stopped.";
  };
  status("Ready.");
})();