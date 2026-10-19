(() => {
  if (window.__uberduckDictationInstalled) return;
  window.__uberduckDictationInstalled = true;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let autoGenerate = true;
  let transcript = "";
  let silenceTimer = null;

  const panel = document.createElement("section");
  panel.id = "uberduck-dictation-panel";
  panel.innerHTML = '<button id="udd-toggle" type="button">🎙 Start dictation</button><label><input id="udd-auto" type="checkbox" checked> Generate when I finish</label><span id="udd-status" role="status">Ready</span>';
  Object.assign(panel.style, {
    position: "fixed", right: "18px", bottom: "18px", zIndex: "2147483647",
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px",
    maxWidth: "min(460px, calc(100vw - 36px))", padding: "12px 14px",
    borderRadius: "12px", background: "#171717", color: "#fff",
    boxShadow: "0 4px 24px #0005", font: "14px/1.4 system-ui,sans-serif"
  });
  const style = document.createElement("style");
  style.textContent = '#uberduck-dictation-panel button{border:0;border-radius:8px;padding:9px 12px;background:#7c3aed;color:white;font-weight:600;cursor:pointer}#uberduck-dictation-panel label{display:flex;align-items:center;gap:5px}#uberduck-dictation-panel span{opacity:.85;font-size:12px}';
  document.documentElement.append(style, panel);

  const toggle = panel.querySelector("#udd-toggle");
  const auto = panel.querySelector("#udd-auto");
  const status = panel.querySelector("#udd-status");
  const setStatus = (s) => { status.textContent = s; };

  function findTextBox() {
    const candidates = [...document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]')]
      .filter(el => el !== panel && !panel.contains(el) && el.getClientRects().length && !el.disabled && !el.readOnly);
    return candidates.find(el => /text|speech|say|prompt|enter/i.test(
      [el.placeholder, el.getAttribute("aria-label"), el.getAttribute("data-placeholder"), el.name].join(" ")
    )) || candidates.find(el => el.tagName === "TEXTAREA") || candidates[0] || null;
  }

  function setBoxText(text) {
    const box = findTextBox();
    if (!box) { setStatus("Can't find the TTS text box"); return false; }
    box.focus();
    if (box.isContentEditable || box.getAttribute("contenteditable") === "true") {
      box.textContent = text;
      box.dispatchEvent(new InputEvent("input", {bubbles:true, inputType:"insertText", data:text}));
    } else {
      const proto = box.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(box, text); else box.value = text;
      box.dispatchEvent(new Event("input", {bubbles:true}));
      box.dispatchEvent(new Event("change", {bubbles:true}));
    }
    return true;
  }

  function generateSpeech() {
    const buttons = [...document.querySelectorAll("button,[role='button']")]
      .filter(b => b.getClientRects().length && !panel.contains(b) && !b.disabled);
    const button = buttons.find(b => /generate speech|generate|text to speech|synthesize/i.test(
      [b.innerText, b.getAttribute("aria-label"), b.title].join(" ")
    ));
    if (!button) { setStatus("Text entered; Generate button not found"); return; }
    button.click();
    setStatus("Generating speech…");
  }

  function finishUtterance() {
    clearTimeout(silenceTimer);
    listening = false;
    toggle.textContent = "🎙 Start dictation";
    if (!transcript.trim()) { setStatus("No speech detected"); return; }
    if (!setBoxText(transcript.trim())) return;
    setStatus("Dictation entered");
    if (autoGenerate) setTimeout(generateSpeech, 350);
  }

  function start() {
    if (!SpeechRecognition) {
      setStatus("Speech recognition isn't supported here; try Chrome");
      return;
    }
    transcript = "";
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onstart = () => { listening = true; toggle.textContent = "■ Stop dictation"; setStatus("Listening…"); };
    recognition.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const phrase = event.results[i][0].transcript;
        if (event.results[i].isFinal) transcript += phrase + " ";
        else interim += phrase;
      }
      setStatus((transcript + interim).trim().slice(-90) || "Listening…");
      clearTimeout(silenceTimer);
      if (transcript.trim()) silenceTimer = setTimeout(() => recognition?.stop(), 1300);
    };
    recognition.onerror = event => setStatus("Mic/recognition: " + event.error);
    recognition.onend = () => {
      if (listening) finishUtterance();
      recognition = null;
    };
    try { recognition.start(); } catch (e) { setStatus("Couldn't start: " + e.message); }
  }

  toggle.addEventListener("click", () => {
    if (listening) {
      clearTimeout(silenceTimer);
      recognition?.stop();
    } else start();
  });
  auto.addEventListener("change", () => { autoGenerate = auto.checked; });
  chrome.storage?.local?.get(["autoGenerate"], data => {
    if (typeof data?.autoGenerate === "boolean") { autoGenerate = data.autoGenerate; auto.checked = autoGenerate; }
  });
  auto.addEventListener("change", () => chrome.storage?.local?.set({autoGenerate}));
})();