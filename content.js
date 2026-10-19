(() => {
  if (window.__inworldVoiceDictationInstalled) return;
  window.__inworldVoiceDictationInstalled = true;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let transcript = "";
  let interimTranscript = "";
  let silenceTimer = null;
  let restartTimer = null;
  let generating = false;
  const SILENCE_MS = 1800;

  const panel = document.createElement("section");
  panel.id = "ivd-panel";
  panel.innerHTML = '<button id="ivd-toggle" type="button">🎙 Start dictation</button><label><input id="ivd-auto" type="checkbox" checked> Generate after pause</label><span id="ivd-status" role="status">Ready on Inworld AI</span>';
  Object.assign(panel.style, {
    position: "fixed", right: "18px", bottom: "18px", zIndex: "2147483647",
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px",
    maxWidth: "min(480px, calc(100vw - 36px))", padding: "12px 14px",
    borderRadius: "12px", background: "#171717", color: "#fff",
    boxShadow: "0 4px 24px #0005", font: "14px/1.4 system-ui,sans-serif"
  });
  const style = document.createElement("style");
  style.textContent = '#ivd-panel button{border:0;border-radius:8px;padding:9px 12px;background:#10a37f;color:white;font-weight:600;cursor:pointer}#ivd-panel label{display:flex;align-items:center;gap:5px}#ivd-panel span{opacity:.9;font-size:12px}';
  document.documentElement.append(style, panel);

  const toggle = panel.querySelector("#ivd-toggle");
  const auto = panel.querySelector("#ivd-auto");
  const status = panel.querySelector("#ivd-status");
  const setStatus = s => { status.textContent = s; };
  const visible = el => !!el && el.getClientRects().length > 0;

  function findTextBox() {
    const candidates = [...document.querySelectorAll('textarea,input:not([type]),input[type="text"],[contenteditable="true"],[role="textbox"]')]
      .filter(el => !panel.contains(el) && visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true");
    const preferred = candidates.find(el => /text|speech|speak|script|voice|tts|enter/i.test([
      el.getAttribute("placeholder"), el.getAttribute("aria-label"),
      el.getAttribute("data-placeholder"), el.getAttribute("name")
    ].join(" ")));
    return preferred || candidates.find(el => el.tagName === "TEXTAREA" || el.isContentEditable) || null;
  }

  function setText(box, text) {
    box.focus();
    if (box.isContentEditable || box.getAttribute("contenteditable") === "true") {
      box.replaceChildren(document.createTextNode(text));
      box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      box.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const proto = box.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(box, text); else box.value = text;
    box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findGenerateButton(box) {
    const buttons = [...document.querySelectorAll("button,[role='button'],input[type='submit']")]
      .filter(b => visible(b) && !panel.contains(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true");
    const label = b => [b.getAttribute("aria-label"), b.title, b.innerText, b.value, b.getAttribute("data-testid")].join(" ").trim();
    const generateButtons = buttons.filter(b => /^generate(?:\s+(?:speech|audio|voice))?\s*$/i.test(label(b)));
    if (!generateButtons.length) return null;

    // Prefer a Generate button near the selected text field, avoiding unrelated page controls.
    let ancestor = box;
    for (let depth = 0; ancestor && depth < 7; depth++, ancestor = ancestor.parentElement) {
      const nearby = generateButtons.find(b => ancestor.contains(b));
      if (nearby) return nearby;
    }
    return generateButtons[0];
  }

  async function generateSpeech(text) {
    if (!text.trim() || generating) return;
    const box = findTextBox();
    if (!box) {
      setStatus("Couldn't find Inworld's TTS text box");
      return;
    }
    const button = findGenerateButton(box);
    if (!button) {
      setStatus("Text entered, but Generate button wasn't found");
      setText(box, text.trim());
      return;
    }
    generating = true;
    try {
      setText(box, text.trim());
      await new Promise(resolve => setTimeout(resolve, 250));
      if (button.disabled || button.getAttribute("aria-disabled") === "true") {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      const refreshedButton = findGenerateButton(box) || button;
      if (!refreshedButton.disabled && refreshedButton.getAttribute("aria-disabled") !== "true") {
        refreshedButton.click();
        setStatus("Generate clicked — speak again when ready");
      } else {
        setStatus("Text entered; Generate is still disabled");
      }
    } finally {
      generating = false;
    }
  }

  function flushTranscript() {
    clearTimeout(silenceTimer);
    const text = [transcript, interimTranscript].filter(Boolean).join(" ").trim();
    transcript = "";
    interimTranscript = "";
    if (!text) return;
    if (auto.checked) {
      void generateSpeech(text);
    } else {
      const box = findTextBox();
      if (!box) { setStatus("Couldn't find Inworld's TTS text box"); return; }
      const existing = (box.innerText || box.value || "").trim();
      setText(box, [existing, text].filter(Boolean).join(" "));
      setStatus("Transcription added to text box");
    }
  }

  function createRecognition() {
    if (!listening || !SpeechRecognition) return;
    const current = new SpeechRecognition();
    recognition = current;
    current.continuous = true;
    current.interimResults = true;
    current.lang = "en-US";

    current.onstart = () => {
      if (listening) {
        toggle.textContent = "■ Stop dictation";
        setStatus("Listening… speak naturally");
      }
    };
    current.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const phrase = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          transcript += phrase + " ";
        } else {
          interim += phrase;
        }
      }
      interimTranscript = interim;
      const preview = (transcript + interim).trim();
      if (preview) setStatus("Transcribing: " + preview.slice(-75));
      clearTimeout(silenceTimer);
      if (preview && auto.checked) {
        silenceTimer = setTimeout(() => {
          if (listening) flushTranscript();
        }, SILENCE_MS);
      }
    };
    current.onerror = event => {
      setStatus("Microphone/recognition: " + event.error);
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
        listening = false;
        toggle.textContent = "🎙 Start dictation";
      }
    };
    current.onend = () => {
      if (recognition === current) recognition = null;
      if (listening) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          if (listening && !recognition) createRecognition();
        }, 250);
      } else {
        flushTranscript();
        toggle.textContent = "🎙 Start dictation";
        setStatus("Dictation stopped");
      }
    };
    try { current.start(); }
    catch (e) {
      if (recognition === current) recognition = null;
      setStatus("Couldn't start microphone: " + e.message);
      listening = false;
      toggle.textContent = "🎙 Start dictation";
    }
  }

  toggle.addEventListener("click", () => {
    if (listening) {
      listening = false;
      clearTimeout(silenceTimer);
      clearTimeout(restartTimer);
      if (recognition) {
        try { recognition.stop(); } catch {}
      } else {
        flushTranscript();
      }
      toggle.textContent = "🎙 Start dictation";
      setStatus("Finishing transcription…");
    } else {
      if (!SpeechRecognition) {
        setStatus("Speech recognition isn't supported here; try Chrome");
        return;
      }
      listening = true;
      toggle.textContent = "■ Stop dictation";
      createRecognition();
    }
  });

  auto.addEventListener("change", () => {
    chrome.storage?.local?.set({ autoGenerate: auto.checked });
  });
  chrome.storage?.local?.get(["autoGenerate"], data => {
    if (typeof data?.autoGenerate === "boolean") auto.checked = data.autoGenerate;
  });
})();