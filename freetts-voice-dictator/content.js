(() => {
  if (window.__freeTtsVoiceDictatorLoaded) return;
  window.__freeTtsVoiceDictatorLoaded = true;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let autoGenerate = true;
  let baseText = "";
  let finalTranscript = "";
  let generationTimer = null;
  let statusNode;
  let startButton;
  let autoButton;

  const panel = document.createElement("section");
  panel.id = "ftvd-panel";
  panel.innerHTML = `
    <div class="ftvd-head"><strong>🎙 Voice Dictator</strong><button type="button" id="ftvd-hide" title="Hide">×</button></div>
    <div class="ftvd-row"><button type="button" id="ftvd-start">Start dictation</button><button type="button" id="ftvd-auto" aria-pressed="true">Auto-generate: ON</button></div>
    <div id="ftvd-status" role="status">Ready. Click Start, then allow microphone access.</div>
  `;
  const style = document.createElement("style");
  style.textContent = `
    #ftvd-panel{position:fixed;z-index:2147483647;right:16px;bottom:16px;width:300px;padding:12px;background:#fff;color:#172033;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 8px 30px #0003;font:13px/1.4 system-ui,sans-serif}
    #ftvd-panel *{box-sizing:border-box} #ftvd-panel .ftvd-head,#ftvd-panel .ftvd-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
    #ftvd-panel button{cursor:pointer;border:0;border-radius:7px;padding:8px 10px;font:600 12px system-ui,sans-serif}
    #ftvd-start{background:#2563eb;color:#fff;flex:1} #ftvd-auto{background:#e2e8f0;color:#172033;flex:1}
    #ftvd-hide{background:transparent;font-size:18px;padding:2px 7px} #ftvd-status{color:#475569;min-height:18px}
  `;
  document.documentElement.append(style, panel);
  statusNode = panel.querySelector("#ftvd-status");
  startButton = panel.querySelector("#ftvd-start");
  autoButton = panel.querySelector("#ftvd-auto");

  function setStatus(message) { statusNode.textContent = message; }
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
  }
  function findTtsField() {
    const candidates = [...document.querySelectorAll('textarea,input:not([type="hidden"]),[contenteditable="true"],[role="textbox"]')].filter(visible);
    const scored = candidates.map(el => {
      const label = [
        el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("name"),
        el.id, el.getAttribute("data-testid"), el.parentElement?.innerText
      ].filter(Boolean).join(" ").toLowerCase();
      let score = 0;
      if (/text to speech|enter text|type.*text|paste.*text|tts|text here|write.*text/.test(label)) score += 8;
      if (el.tagName === "TEXTAREA") score += 3;
      if (el.isContentEditable || el.getAttribute("contenteditable") === "true") score += 2;
      if (/search|email|password|voice name/.test(label)) score -= 10;
      return {el, score};
    }).sort((a,b) => b.score-a.score);
    return scored[0]?.score > 0 ? scored[0].el : candidates.find(el => el.tagName === "TEXTAREA") || null;
  }
  function setFieldValue(el, value) {
    el.focus();
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      el.textContent = value;
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value); else el.value = value;
    }
    el.dispatchEvent(new InputEvent("input", {bubbles:true, inputType:"insertText", data:value}));
    el.dispatchEvent(new Event("change", {bubbles:true}));
  }
  function findGenerateButton() {
    const els = [...document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')].filter(visible);
    const matches = els.map(el => {
      const text = [el.innerText,el.textContent,el.getAttribute("aria-label"),el.getAttribute("title"),el.value].filter(Boolean).join(" ").trim().toLowerCase();
      let score = 0;
      if (/convert to speech/.test(text)) score = 100;
      else if (/generate speech|generate audio|text to speech|speak now/.test(text)) score = 90;
      else if (/^play$|play audio|listen/.test(text)) score = 70;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") score = 0;
      return {el,score};
    }).sort((a,b)=>b.score-a.score);
    return matches[0]?.score ? matches[0].el : null;
  }
  function scheduleGenerate() {
    clearTimeout(generationTimer);
    if (!autoGenerate || !finalTranscript.trim()) return;
    generationTimer = setTimeout(() => {
      const field = findTtsField();
      if (!field) { setStatus("Speech captured, but I couldn't find the TTS text field."); return; }
      const button = findGenerateButton();
      if (!button) { setStatus("Text entered. Generate/Play button not found—click it manually."); return; }
      button.click();
      setStatus("Speech generated automatically.");
    }, 1100);
  }
  function updateText(interim) {
    const field = findTtsField();
    if (!field) { setStatus("Couldn't find the TTS text field. Open the FreeTTS text-to-speech page."); return; }
    setFieldValue(field, [baseText, finalTranscript, interim].filter(Boolean).join(" ").trim());
    if (finalTranscript.trim()) scheduleGenerate();
  }
  function start() {
    if (!SpeechRecognition) {
      setStatus("Speech recognition isn't supported here. Try Chrome on desktop.");
      return;
    }
    const field = findTtsField();
    if (!field) { setStatus("TTS field not found. Open the FreeTTS text-to-speech page first."); return; }
    clearTimeout(generationTimer);
    baseText = "";
    finalTranscript = "";
    setFieldValue(field, "");
    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => { listening = true; startButton.textContent = "Stop dictation"; setStatus("Listening… speak into your microphone."); };
    recognition.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const phrase = event.results[i][0].transcript.trim();
        if (event.results[i].isFinal && phrase) finalTranscript = (finalTranscript + " " + phrase).trim();
        else interim += phrase + " ";
      }
      updateText(interim.trim());
    };
    recognition.onerror = event => setStatus("Microphone/recognition: " + event.error + ". Check Chrome's mic permission.");
    recognition.onend = () => {
      listening = false;
      startButton.textContent = "Start dictation";
      if (finalTranscript.trim()) scheduleGenerate();
      setStatus("Dictation stopped. " + (finalTranscript ? "Text is in the TTS field." : "No speech captured."));
    };
    try { recognition.start(); } catch (e) { setStatus("Couldn't start recognition. Click Start again."); }
  }
  function stop() {
    clearTimeout(generationTimer);
    if (recognition && listening) recognition.stop();
    listening = false;
    startButton.textContent = "Start dictation";
  }
  startButton.addEventListener("click", () => listening ? stop() : start());
  autoButton.addEventListener("click", () => {
    autoGenerate = !autoGenerate;
    autoButton.textContent = "Auto-generate: " + (autoGenerate ? "ON" : "OFF");
    autoButton.setAttribute("aria-pressed", String(autoGenerate));
    setStatus(autoGenerate ? "Auto-generation enabled." : "Auto-generation disabled; use the page's blue play button.");
  });
  panel.querySelector("#ftvd-hide").addEventListener("click", () => { stop(); panel.remove(); style.remove(); });
})();