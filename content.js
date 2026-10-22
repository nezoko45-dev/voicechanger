(() => {
  if (window.__pocketWebDictationInstalled) return;
  window.__pocketWebDictationInstalled = true;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let running = false;
  let busy = false;
  let restartTimer = null;
  let phraseTimer = null;
  let latestPhrase = "";
  let statusNode = null;
  const PAUSE_MS = 1800;

  function showStatus(message) {
    if (!statusNode || !statusNode.isConnected) {
      statusNode = document.createElement("div");
      statusNode.id = "pocketweb-dictation-status";
      Object.assign(statusNode.style, {
        position:"fixed", right:"16px", bottom:"16px", zIndex:"2147483647",
        background:"#111827", color:"#fff", padding:"10px 14px", borderRadius:"10px",
        font:"13px system-ui,sans-serif", maxWidth:"320px", boxShadow:"0 4px 20px #0004"
      });
      document.documentElement.appendChild(statusNode);
    }
    statusNode.textContent = "VoiceChanger Dictation: " + message;
  }

  function findTextBox() {
    const candidates = [...document.querySelectorAll("textarea,input:not([type]),input[type=text],[contenteditable=true],[role=textbox]")];
    return candidates.find(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly;
    });
  }

  function findGenerateButton() {
    const buttons = [...document.querySelectorAll("button,[role=button],input[type=button],input[type=submit]")];
    return buttons.find(el => {
      const text = (el.innerText || el.textContent || el.value || "").trim().toLowerCase();
      return text.includes("generate speech") || text === "generate" || text.includes("generate audio");
    });
  }

  function setText(el, text) {
    el.focus();
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      el.textContent = text;
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text); else el.value = text;
    }
    el.dispatchEvent(new InputEvent("input", { bubbles:true, inputType:"insertText", data:text }));
    el.dispatchEvent(new Event("change", { bubbles:true }));
  }

  function stopRecognition() {
    clearTimeout(restartTimer);
    clearTimeout(phraseTimer);
    try { recognition?.stop(); } catch {}
  }

  function schedulePhrase(text) {
    latestPhrase = text.trim();
    clearTimeout(phraseTimer);
    if (!latestPhrase) return;
    phraseTimer = setTimeout(() => {
      const phrase = latestPhrase;
      latestPhrase = "";
      processPhrase(phrase);
    }, PAUSE_MS);
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  function findResultPlayButton(phrase) {
    const buttons = [...document.querySelectorAll("button,[role=button]")].filter(isVisible);
    const playButtons = buttons.filter(el => {
      const text = (el.innerText || el.textContent || el.getAttribute("aria-label") || el.title || "").trim().toLowerCase();
      const label = (el.getAttribute("aria-label") || el.title || "").toLowerCase();
      return text === "play" || label === "play" || label.includes("play audio") || label.includes("play result");
    });

    // Prefer a Play button in a result/card that contains the newly generated text.
    const phraseLower = phrase.trim().toLowerCase();
    for (const button of playButtons) {
      let node = button;
      for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
        const text = (node.innerText || node.textContent || "").toLowerCase();
        if (text.includes(phraseLower) && text.length < 5000) return button;
      }
    }
    // Fallback: prefer buttons near audio players, excluding reference/source upload sections.
    return playButtons.find(button => {
      const area = button.closest("section,article,[class*='result'],[class*='output'],[class*='generated']") || button.parentElement;
      const text = (area?.innerText || "").toLowerCase();
      return !text.includes("reference audio") && !text.includes("upload reference");
    }) || null;
  }

  async function waitForResultPlayButton(phrase, timeoutMs = 60000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!running) return null;
      const button = findResultPlayButton(phrase);
      if (button) return button;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    return null;
  }

  async function waitForPlaybackToFinish(playButton, phrase) {
    // If the result exposes an audio element, wait for its playback to finish.
    const started = Date.now();
    while (running && Date.now() - started < 120000) {
      const audio = [...document.querySelectorAll("audio,video")].find(el => {
        const area = el.closest("section,article,[class*='result'],[class*='output'],[class*='generated']") || el.parentElement;
        return (area?.innerText || "").toLowerCase().includes(phrase.trim().toLowerCase());
      });
      if (audio) {
        if (audio.ended) return;
        if (!audio.paused) {
          await new Promise(resolve => {
            const done = () => { audio.removeEventListener("ended", done); resolve(); };
            audio.addEventListener("ended", done, { once:true });
            const check = setInterval(() => {
              if (!running || audio.ended) { clearInterval(check); done(); }
            }, 400);
          });
          return;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 400));
      // If the site's Play button becomes Pause and then back to Play, playback likely finished.
      const label = (playButton.getAttribute("aria-label") || playButton.title || playButton.textContent || "").toLowerCase();
      if (started + 2500 < Date.now() && label.includes("play")) return;
    }
  }

  async function processPhrase(phrase) {
    if (!running || busy || !phrase) return;
    busy = true;
    stopRecognition();
    try {
      showStatus('Generating: "' + phrase.slice(0, 70) + (phrase.length > 70 ? "…" : "") + '"');
      const box = findTextBox();
      const button = findGenerateButton();
      if (!box || !button) throw new Error("Could not find the text box or Generate Speech button on this page.");
      setText(box, phrase);
      button.click();
      showStatus("Waiting for the generated result's Play button…");
      const playButton = await waitForResultPlayButton(phrase);
      if (!running) return;
      if (!playButton) throw new Error("Could not find the Play button under the generated result after 60 seconds.");
      showStatus("Playing generated result…");
      playButton.click();
      await waitForPlaybackToFinish(playButton, phrase);
    } catch (error) {
      showStatus(error.message || "Something went wrong.");
      await new Promise(resolve => setTimeout(resolve, 2500));
    } finally {
      busy = false;
      if (running) startRecognition();
    }
  }

  function startRecognition() {
    if (!running || busy) return;
    if (!SpeechRecognition) {
      showStatus("Speech recognition is not supported here. Try desktop Chrome.");
      running = false;
      return;
    }
    try { recognition?.abort(); } catch {}
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = document.documentElement.lang || navigator.language || "en-US";
    recognition.onresult = event => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript + " ";
      }
      if (finalText.trim()) schedulePhrase((latestPhrase ? latestPhrase + " " : "") + finalText.trim());
    };
    recognition.onerror = event => {
      if (running && event.error !== "no-speech" && event.error !== "aborted") {
        showStatus("Microphone recognition: " + event.error);
      }
    };
    recognition.onend = () => {
      if (running && !busy) {
        restartTimer = setTimeout(() => {
          if (running && !busy) startRecognition();
        }, 350);
      }
    };
    try {
      recognition.start();
      showStatus("Listening… pause for about 2 seconds to generate each sentence.");
    } catch {
      restartTimer = setTimeout(() => { if (running && !busy) startRecognition(); }, 700);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === "START") {
      if (!SpeechRecognition) {
        sendResponse({ message:"Speech recognition is not supported by this browser. Use desktop Chrome." });
        return;
      }
      running = true;
      busy = false;
      startRecognition();
      sendResponse({ message:"Listening started. Keep this tab open." });
      return;
    }
    if (message?.action === "STOP") {
      running = false;
      busy = false;
      latestPhrase = "";
      stopRecognition();
      try { recognition?.abort(); } catch {}
      showStatus("Stopped.");
      sendResponse({ message:"Listening stopped." });
    }
  });
})();