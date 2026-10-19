(() => {
  if (window.__chatgptVoiceDictationInstalled) return;
  window.__chatgptVoiceDictationInstalled = true;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let autoReadAloud = true;
  let transcript = "";
  let silenceTimer = null;
  let restartTimer = null;
  let sendQueue = Promise.resolve();

  const panel = document.createElement("section");
  panel.id = "cgd-panel";
  panel.innerHTML = '<button id="cgd-toggle" type="button">🎙 Start continuous dictation</button><label><input id="cgd-auto" type="checkbox" checked> Send and read aloud</label><span id="cgd-status" role="status">Ready on ChatGPT</span>';
  Object.assign(panel.style, {
    position: "fixed", right: "18px", bottom: "18px", zIndex: "2147483647",
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px",
    maxWidth: "min(480px, calc(100vw - 36px))", padding: "12px 14px",
    borderRadius: "12px", background: "#171717", color: "#fff",
    boxShadow: "0 4px 24px #0005", font: "14px/1.4 system-ui,sans-serif"
  });
  const style = document.createElement("style");
  style.textContent = '#cgd-panel button{border:0;border-radius:8px;padding:9px 12px;background:#10a37f;color:white;font-weight:600;cursor:pointer}#cgd-panel label{display:flex;align-items:center;gap:5px}#cgd-panel span{opacity:.9;font-size:12px}';
  document.documentElement.append(style, panel);

  const toggle = panel.querySelector("#cgd-toggle");
  const auto = panel.querySelector("#cgd-auto");
  const status = panel.querySelector("#cgd-status");
  const setStatus = s => { status.textContent = s; };
  const visible = el => !!el && el.getClientRects().length > 0;

  function findComposer() {
    const selectors = [
      "#prompt-textarea",
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[placeholder]',
      'textarea'
    ];
    for (const selector of selectors) {
      const el = [...document.querySelectorAll(selector)].find(x =>
        !panel.contains(x) && visible(x) && !x.disabled && x.getAttribute("aria-disabled") !== "true"
      );
      if (el) return el;
    }
    return null;
  }

  function setComposerText(box, text) {
    box.focus();
    if (box.isContentEditable || box.getAttribute("contenteditable") === "true") {
      box.replaceChildren(document.createTextNode(text));
      box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    } else {
      const proto = box.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(box, text); else box.value = text;
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function findSendButton() {
    const buttons = [...document.querySelectorAll("button,[role='button']")].filter(b => visible(b) && !panel.contains(b) && !b.disabled);
    return buttons.find(b => /send prompt|send message|send/i.test([b.getAttribute("aria-label"), b.title, b.innerText].join(" ")))
      || buttons.find(b => b.getAttribute("data-testid") === "send-button");
  }

  function assistantMessages() {
    return [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  }

  function isGenerating() {
    return [...document.querySelectorAll("button,[role='button']")].some(b =>
      visible(b) && /stop generating|stop streaming/i.test([b.getAttribute("aria-label"), b.title, b.innerText].join(" "))
    ) || !!document.querySelector('button[data-testid="stop-button"]');
  }

  function readAloudButton(message) {
    const buttons = [...message.querySelectorAll("button,[role='button']")].filter(visible);
    return buttons.find(b => /read aloud|read response|play audio|listen/i.test(
      [b.getAttribute("aria-label"), b.title, b.innerText, b.getAttribute("data-testid")].join(" ")
    )) || null;
  }

  async function waitForAndReadAloud(previousCount) {
    setStatus("Waiting for ChatGPT's reply…");
    const started = Date.now();
    let foundNewAt = 0;
    let stableSince = 0;
    while (Date.now() - started < 120000) {
      if (!listening && !autoReadAloud) return;
      const messages = assistantMessages();
      if (messages.length > previousCount) {
        foundNewAt = foundNewAt || Date.now();
        if (!isGenerating()) {
          stableSince = stableSince || Date.now();
          if (Date.now() - stableSince >= 1400) {
            const button = readAloudButton(messages[messages.length - 1]);
            if (button) {
              button.click();
              setStatus("Read aloud started. Keep speaking…");
              return;
            }
            if (Date.now() - foundNewAt > 5000) {
              setStatus("Reply ready, but Read Aloud button wasn't found");
              return;
            }
          }
        } else {
          stableSince = 0;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    setStatus("Timed out waiting for ChatGPT's reply");
  }

  async function sendToChatGPT(text) {
    const box = findComposer();
    if (!box) {
      setStatus("Can't find ChatGPT's message box");
      return;
    }
    const beforeCount = assistantMessages().length;
    setComposerText(box, text);
    await new Promise(resolve => setTimeout(resolve, 180));
    const send = findSendButton();
    if (send) {
      send.click();
    } else {
      box.focus();
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    }
    setStatus("Message sent. Waiting for reply…");
    if (autoReadAloud) await waitForAndReadAloud(beforeCount);
  }

  function flushTranscript() {
    clearTimeout(silenceTimer);
    const text = transcript.trim();
    transcript = "";
    if (!text) return;
    if (autoReadAloud) {
      sendQueue = sendQueue.then(() => sendToChatGPT(text)).catch(err => setStatus("Couldn't send: " + err.message));
    } else {
      const box = findComposer();
      if (!box) { setStatus("Can't find ChatGPT's message box"); return; }
      const existing = (box.innerText || box.value || "").trim();
      setComposerText(box, [existing, text].filter(Boolean).join(" "));
      setStatus("Dictation added to message box");
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
        toggle.textContent = "■ Stop continuous dictation";
        setStatus("Listening… pause when you've finished a thought");
      }
    };
    current.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const phrase = event.results[i][0].transcript;
        if (event.results[i].isFinal) transcript += phrase + " ";
        else interim += phrase;
      }
      const preview = (transcript + interim).trim();
      if (preview) setStatus("Listening: " + preview.slice(-85));
      clearTimeout(silenceTimer);
      if (transcript.trim()) silenceTimer = setTimeout(flushTranscript, 1500);
    };
    current.onerror = event => {
      setStatus("Microphone/recognition: " + event.error);
      if (["not-allowed", "service-not-allowed", "audio-capture"].includes(event.error)) {
        listening = false;
        toggle.textContent = "🎙 Start continuous dictation";
      }
    };
    current.onend = () => {
      if (recognition === current) recognition = null;
      if (listening) {
        flushTranscript();
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          if (listening && !recognition) createRecognition();
        }, 250);
      } else {
        flushTranscript();
        toggle.textContent = "🎙 Start continuous dictation";
        setStatus("Stopped");
      }
    };
    try { current.start(); }
    catch (e) {
      if (recognition === current) recognition = null;
      setStatus("Couldn't start microphone: " + e.message);
      listening = false;
      toggle.textContent = "🎙 Start continuous dictation";
    }
  }

  toggle.addEventListener("click", () => {
    if (listening) {
      listening = false;
      clearTimeout(silenceTimer);
      clearTimeout(restartTimer);
      try { recognition?.stop(); } catch {}
      flushTranscript();
      toggle.textContent = "🎙 Start continuous dictation";
      setStatus("Stopping…");
    } else {
      if (!SpeechRecognition) {
        setStatus("Speech recognition isn't supported here; try Chrome");
        return;
      }
      transcript = "";
      listening = true;
      toggle.textContent = "■ Stop continuous dictation";
      createRecognition();
    }
  });

  auto.addEventListener("change", () => {
    autoReadAloud = auto.checked;
    chrome.storage?.local?.set({ autoGenerate: autoReadAloud });
  });
  chrome.storage?.local?.get(["autoGenerate"], data => {
    if (typeof data?.autoGenerate === "boolean") {
      autoReadAloud = data.autoGenerate;
      auto.checked = autoReadAloud;
    }
  });
})();