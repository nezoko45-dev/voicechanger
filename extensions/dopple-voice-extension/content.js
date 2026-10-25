(() => {
  if (window.__doppleVoiceDictationLoaded) return;
  window.__doppleVoiceDictationLoaded = true;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let running = false;
  let restarting = false;
  let restartTimer = null;
  let sessionTimer = null;
  let silenceTimer = null;
  let buffer = "";
  let autoSubmit = true;
  let silenceMs = 1600;
  const MAX_SESSION_MS = 45000;
  let panel, statusEl, transcriptEl, startBtn, stopBtn;

  const setStatus = (message) => { if (statusEl) statusEl.textContent = message; };

  function findComposer() {
    const selectors = [
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="chat" i]',
      'textarea[placeholder*="say" i]',
      'textarea',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      'input[type="text"]'
    ];
    for (const selector of selectors) {
      const elements = [...document.querySelectorAll(selector)].filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && !el.disabled && !el.readOnly &&
          style.visibility !== "hidden" && style.display !== "none";
      });
      if (elements.length) return elements[elements.length - 1];
    }
    return null;
  }

  function getText(el) {
    return el.isContentEditable ? el.textContent || "" : el.value || "";
  }

  function setComposerText(el, text) {
    el.focus();
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      el.textContent = text;
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
    }
    el.dispatchEvent(new InputEvent("input", {
      bubbles: true, inputType: "insertText", data: text
    }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function pressEnter(el) {
    el.focus();
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(new KeyboardEvent(type, {
        key: "Enter", code: "Enter", keyCode: 13, which: 13,
        bubbles: true, cancelable: true
      }));
    }
    // Some chat composers submit through their form's Enter handler.
    const form = el.closest("form");
    if (form && typeof form.requestSubmit === "function") {
      setTimeout(() => {
        if (document.contains(form)) {
          const submit = form.querySelector('button[type="submit"],input[type="submit"]');
          if (!submit || !submit.disabled) {
            try { form.requestSubmit(submit || undefined); } catch (_) {}
          }
        }
      }, 80);
    }
  }

  function sendBuffer() {
    clearTimeout(silenceTimer);
    const text = buffer.trim();
    if (!text) return;
    const composer = findComposer();
    if (!composer) {
      setStatus("Can't find the message textbox — transcript kept for retry");
      return;
    }
    const existing = getText(composer).trim();
    setComposerText(composer, existing ? existing + " " + text : text);
    buffer = "";
    if (transcriptEl) transcriptEl.textContent = "Recognized: " + text;

    if (!autoSubmit) {
      setStatus("Text inserted — auto-submit is off");
      return;
    }
    setTimeout(() => {
      const current = findComposer();
      if (!current) {
        setStatus("Text inserted; couldn't refocus the textbox");
        return;
      }
      pressEnter(current);
      setStatus("Pressed Enter to submit");
    }, 120);
  }

  function scheduleSend() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(sendBuffer, silenceMs);
  }

  function clearSessionTimer() {
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = null;
  }

  function scheduleRestart(delay = 300) {
    if (!running || restarting) return;
    restarting = true;
    clearSessionTimer();
    clearTimeout(restartTimer);
    const old = recognition;
    recognition = null;
    if (old) {
      try {
        old.onend = null;
        old.onerror = null;
        old.onresult = null;
        old.stop();
      } catch (_) {}
    }
    setStatus("Speech session ended — restarting…");
    restartTimer = setTimeout(() => {
      restarting = false;
      if (running) startRecognition();
    }, delay);
  }

  function startRecognition() {
    if (!SpeechRecognition) {
      setStatus("Speech recognition isn't supported. Please use Chrome.");
      running = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      return;
    }
    if (!running || recognition || restarting) return;

    try {
      const rec = new SpeechRecognition();
      recognition = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        if (recognition !== rec) return;
        setStatus("Listening — session will restart automatically");
        clearSessionTimer();
        sessionTimer = setTimeout(() => {
          if (running && recognition === rec) scheduleRestart(150);
        }, MAX_SESSION_MS);
      };

      rec.onresult = (event) => {
        if (recognition !== rec) return;
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const phrase = result[0]?.transcript || "";
          if (result.isFinal && phrase.trim()) {
            buffer += (buffer ? " " : "") + phrase.trim();
            if (transcriptEl) transcriptEl.textContent = "Hearing: " + buffer;
            scheduleSend();
          } else {
            interim += phrase;
          }
        }
        if (interim.trim() && transcriptEl) {
          transcriptEl.textContent = "Hearing: " + (buffer ? buffer + " " : "") + interim.trim();
        }
      };

      rec.onerror = (event) => {
        if (recognition !== rec) return;
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          running = false;
          clearSessionTimer();
          setStatus("Microphone blocked — allow access and click Start again.");
          startBtn.disabled = false;
          stopBtn.disabled = true;
          return;
        }
        if (["network", "no-speech", "aborted", "audio-capture"].includes(event.error)) {
          setStatus("Speech recognition " + event.error + " — reconnecting…");
          setTimeout(() => {
            if (running && recognition === rec) scheduleRestart(250);
          }, 250);
        } else {
          setStatus("Recognition issue — restarting session…");
        }
      };

      rec.onend = () => {
        if (recognition !== rec) return;
        recognition = null;
        clearSessionTimer();
        if (running) {
          restarting = true;
          setStatus("Recognition stopped/timed out — restarting…");
          clearTimeout(restartTimer);
          restartTimer = setTimeout(() => {
            restarting = false;
            if (running) startRecognition();
          }, 300);
        } else {
          startBtn.disabled = false;
          stopBtn.disabled = true;
          setStatus("Stopped");
        }
      };

      rec.start();
    } catch (_) {
      recognition = null;
      clearSessionTimer();
      if (running) {
        restarting = true;
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          restarting = false;
          if (running) startRecognition();
        }, 900);
      }
      setStatus("Starting/restarting speech recognition…");
    }
  }

  function begin() {
    if (running) return;
    running = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus("Starting microphone…");
    startRecognition();
  }

  function stopRecognition() {
    running = false;
    restarting = false;
    clearTimeout(restartTimer);
    clearTimeout(silenceTimer);
    clearSessionTimer();
    const old = recognition;
    recognition = null;
    if (old) {
      try {
        old.onend = null;
        old.onerror = null;
        old.onresult = null;
        old.stop();
      } catch (_) {}
    }
    if (buffer.trim()) sendBuffer();
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus("Stopped");
  }

  function makePanel() {
    panel = document.createElement("div");
    panel.id = "dopple-voice-dictation-panel";
    panel.innerHTML = `
      <div class="dvd-head"><strong>🎙 Dopple Dictation</strong><button id="dvd-hide" title="Hide controls">−</button></div>
      <div id="dvd-status">Ready</div>
      <div id="dvd-transcript">Click Start and allow microphone access.</div>
      <div class="dvd-actions"><button id="dvd-start">Start</button><button id="dvd-stop" disabled>Stop</button><button id="dvd-send">Send now</button></div>
      <label class="dvd-option"><input id="dvd-auto" type="checkbox" checked> Auto-submit with Enter after pause</label>
      <label class="dvd-option">Pause before submit <select id="dvd-delay"><option value="1000">1 second</option><option value="1600" selected>1.6 seconds</option><option value="2200">2.2 seconds</option><option value="3000">3 seconds</option></select></label>
    `;
    Object.assign(panel.style, {
      position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647",
      width: "290px", padding: "12px", background: "#171923", color: "#f8fafc",
      border: "1px solid #4b5563", borderRadius: "12px", boxShadow: "0 8px 30px #0008",
      font: "13px/1.4 system-ui,sans-serif"
    });
    const style = document.createElement("style");
    style.textContent = `
      #dopple-voice-dictation-panel *{box-sizing:border-box}
      #dopple-voice-dictation-panel .dvd-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
      #dopple-voice-dictation-panel button{border:0;border-radius:7px;padding:7px 10px;cursor:pointer;background:#4f46e5;color:white;font-weight:600}
      #dopple-voice-dictation-panel button:disabled{opacity:.45;cursor:default}
      #dopple-voice-dictation-panel #dvd-hide{background:#374151;padding:2px 8px}
      #dopple-voice-dictation-panel #dvd-status{color:#a5f3fc;margin:4px 0}
      #dopple-voice-dictation-panel #dvd-transcript{background:#242938;border-radius:7px;padding:8px;min-height:38px;max-height:90px;overflow:auto;overflow-wrap:anywhere;margin:7px 0}
      #dopple-voice-dictation-panel .dvd-actions{display:flex;gap:6px;margin:8px 0}
      #dopple-voice-dictation-panel .dvd-option{display:flex;gap:7px;align-items:center;margin-top:7px;color:#d1d5db}
      #dopple-voice-dictation-panel select{margin-left:auto;background:#242938;color:white;border:1px solid #4b5563;border-radius:5px;padding:4px}
    `;
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(panel);
    statusEl = panel.querySelector("#dvd-status");
    transcriptEl = panel.querySelector("#dvd-transcript");
    startBtn = panel.querySelector("#dvd-start");
    stopBtn = panel.querySelector("#dvd-stop");
    startBtn.addEventListener("click", begin);
    stopBtn.addEventListener("click", stopRecognition);
    panel.querySelector("#dvd-send").addEventListener("click", sendBuffer);
    panel.querySelector("#dvd-auto").addEventListener("change", (event) => {
      autoSubmit = event.target.checked;
      setStatus(autoSubmit ? "Auto-submit with Enter enabled" : "Text insertion only");
    });
    panel.querySelector("#dvd-delay").addEventListener("change", (event) => {
      silenceMs = Number(event.target.value) || 1600;
    });
    panel.querySelector("#dvd-hide").addEventListener("click", () => {
      const hidden = panel.dataset.hidden === "1";
      panel.dataset.hidden = hidden ? "0" : "1";
      [...panel.children].slice(1).forEach((el) => { el.style.display = hidden ? "" : "none"; });
      panel.querySelector("#dvd-hide").textContent = hidden ? "−" : "+";
    });
  }

  makePanel();
})();
