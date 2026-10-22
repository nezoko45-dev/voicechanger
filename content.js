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
  let lastSpeechAt = 0;
  let generationStartedAt = 0;
  let statusNode = null;
  const PAUSE_MS = 2500;

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

  function armSilenceTimer() {
    clearTimeout(phraseTimer);
    if (!latestPhrase) return;
    phraseTimer = setTimeout(() => {
      const remaining = PAUSE_MS - (Date.now() - lastSpeechAt);
      if (remaining > 0) {
        phraseTimer = setTimeout(() => {
          if (Date.now() - lastSpeechAt >= PAUSE_MS && latestPhrase) {
            const phrase = latestPhrase.trim();
            latestPhrase = "";
            processPhrase(phrase);
          } else {
            armSilenceTimer();
          }
        }, remaining);
        return;
      }
      const phrase = latestPhrase.trim();
      latestPhrase = "";
      if (phrase) processPhrase(phrase);
    }, PAUSE_MS);
  }

  function schedulePhrase(text) {
    latestPhrase = text.trim();
    lastSpeechAt = Date.now();
    armSilenceTimer();
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  }

  function findResultPlayButton(phrase) {
    // The page has multiple Play buttons (including a top/reference player).
    // Choose the LAST visible Play control in DOM order, which belongs to the
    // bottom/latest generated output on the PocketWebTools page.
    const buttons = [...document.querySelectorAll("button,[role=button],input[type=button]")].filter(isVisible);
    const playButtons = buttons.filter(el => {
      const text = (el.innerText || el.textContent || el.value || "").trim().toLowerCase();
      const label = (el.getAttribute("aria-label") || el.title || "").trim().toLowerCase();
      return text === "play" || label === "play" || label.includes("play audio") || label.includes("play result");
    });
    const eligible = playButtons.filter(button => {
      let node = button;
      for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
        const text = (node.innerText || node.textContent || "").toLowerCase();
        if (text.includes("reference audio") || text.includes("upload reference")) return false;
      }
      return true;
    });
    return eligible.length ? eligible[eligible.length - 1] : null;
  }
  async function waitForResultPlayButton(phrase, timeoutMs = 60000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (!running) return null;
      const button = findResultPlayButton(phrase);
      // Prefer a newly-created Play control. Some versions of the page reuse an
      // existing result card, so after a short render grace period accept the
      // latest visible non-reference Play control even if its node was reused.
      if (button && generationStartedAt && button.getAttribute("data-pw-seen") !== "old") return button;
      if (button && generationStartedAt && Date.now() - generationStartedAt > 5000) {
        const area = button.closest("section,article,[class*='result'],[class*='output'],[class*='generated']") || button.parentElement;
        const areaText = (area?.innerText || "").toLowerCase();
        if (areaText.includes(phrase.trim().toLowerCase()) || areaText.includes("generated") || areaText.includes("result")) return button;
      }
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
      // Stop recognition and cancel any pending silence timer before generating.
      clearTimeout(phraseTimer);
      latestPhrase = "";
      // Mark existing Play controls so they can never be mistaken for this result.
      document.querySelectorAll("button,[role=button],input[type=button]").forEach(el => {
        const t = (el.innerText || el.textContent || el.value || el.getAttribute("aria-label") || el.title || "").trim().toLowerCase();
        if (t === "play" || t.includes("play audio") || t.includes("play result")) el.setAttribute("data-pw-seen", "old");
      });
      generationStartedAt = Date.now();
      setText(box, phrase);
      button.click();
      showStatus("Waiting for the generated result's Play button…");
      const playButton = await waitForResultPlayButton(phrase);
      if (!running) return;
      if (!playButton) throw new Error("Could not find the Play button under the generated result after 60 seconds.");
      showStatus("Playing generated result…");
      playButton.removeAttribute("data-pw-seen");
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
    // Do not abort a previous instance here: its delayed onend event can race
    // with the new instance and create duplicate recognizers or stop dictation.
    const instance = new SpeechRecognition();
    recognition = instance;
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = document.documentElement.lang || navigator.language || "en-US";
    instance.onresult = event => {
      if (instance !== recognition || !running || busy) return;
      // Any speech event cancels the quiet timer immediately, including interim speech.
      if (event.results.length) {
        const latestResult = event.results[event.results.length - 1];
        if (latestResult && !latestResult.isFinal) {
          lastSpeechAt = Date.now();
          // Keep the pending phrase timer armed; clearing it here could leave
          // dictation permanently waiting if no further final event arrives.
          if (latestPhrase) armSilenceTimer();
          showStatus("Speech detected — waiting for silence…");
        }
      }
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript + " ";
      }
      if (finalText.trim()) schedulePhrase((latestPhrase ? latestPhrase + " " : "") + finalText.trim());
    };
    instance.onerror = event => {
      if (instance !== recognition) return;
      if (running && event.error !== "no-speech" && event.error !== "aborted") {
        showStatus("Microphone recognition: " + event.error + ". Retrying…");
      }
    };
    instance.onend = () => {
      if (instance !== recognition) return;
      if (running && !busy) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
          if (running && !busy && instance === recognition) {
            recognition = null;
            startRecognition();
          }
        }, 500);
      }
    };
    try {
      instance.start();
      showStatus("Listening… pause for about 2.5 seconds to generate each sentence.");
    } catch (error) {
      showStatus("Could not start microphone recognition: " + (error?.message || "retrying") + ".");
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (running && !busy && instance === recognition) {
          recognition = null;
          startRecognition();
        }
      }, 1000);
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
      lastSpeechAt = 0;
      stopRecognition();
      try { recognition?.abort(); } catch {}
      showStatus("Stopped.");
      sendResponse({ message:"Listening stopped." });
    }
  });
})();