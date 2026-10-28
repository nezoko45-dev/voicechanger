(() => {
  if (window.__chatGPTDictationLoopInstalled) return;
  window.__chatGPTDictationLoopInstalled = true;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let running = false;
  let busy = false;
  let silenceSeconds = 2;
  let pendingFinal = "";
  let interim = "";
  let silenceTimer = null;
  let restartTimer = null;
  let statusNode = null;
  let lastStatus = "Stopped";
  let recognitionActive = false;

  function setStatus(text) {
    lastStatus = text;
    if (!statusNode || !statusNode.isConnected) {
      statusNode = document.createElement("div");
      statusNode.id = "chatgpt-dictation-loop-status";
      Object.assign(statusNode.style, {
        position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647",
        background: "#202123", color: "#fff", padding: "9px 12px",
        borderRadius: "10px", font: "13px/1.35 system-ui,sans-serif",
        boxShadow: "0 2px 12px #0004", maxWidth: "280px"
      });
      document.documentElement.appendChild(statusNode);
    }
    statusNode.textContent = "Dictation Loop: " + text;
  }

  function clearTimers() {
    clearTimeout(silenceTimer);
    clearTimeout(restartTimer);
    silenceTimer = restartTimer = null;
  }

  function composer() {
    return document.querySelector('#prompt-textarea[contenteditable="true"]')
      || document.querySelector('[data-testid="prompt-textarea"][contenteditable="true"]')
      || document.querySelector('div[contenteditable="true"][role="textbox"]')
      || document.querySelector('textarea[placeholder]');
  }

  function setComposerText(el, text) {
    el.focus();
    if (el instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter ? setter.call(el, text) : el.value = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    } else {
      el.replaceChildren();
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      el.appendChild(paragraph);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
  }

  function clickButtonByLabel(names, root = document) {
    const buttons = [...root.querySelectorAll("button,[role='button']")];
    const norm = s => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    for (const name of names) {
      const target = norm(name);
      const button = buttons.find(b => {
        const labels = [b.getAttribute("aria-label"), b.getAttribute("title"), b.innerText, b.getAttribute("data-testid")];
        return labels.some(label => norm(label) === target || norm(label).includes(target));
      });
      if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
        button.click();
        return true;
      }
    }
    return false;
  }

  let assistantCountBeforeSend = 0;
  let assistantTextBeforeSend = "";

  function sendMessage() {
    if (!running || busy) return;
    const text = (pendingFinal + " " + interim).replace(/\s+/g, " ").trim();
    pendingFinal = "";
    interim = "";
    if (!text) {
      // Recognition can fire a silence timeout before Chrome delivers its final
      // result. Don't treat that as a completed turn; keep listening and expose
      // a useful status instead of silently losing the utterance.
      setStatus("No speech text received yet — check microphone access, then keep speaking.");
      scheduleRestart(700);
      return;
    }
    busy = true;
    stopRecognition();
    const el = composer();
    if (!el) {
      setStatus("Can't find ChatGPT's message box. Reload this tab.");
      busy = false;
      scheduleRestart(2500);
      return;
    }
    assistantCountBeforeSend = assistantMessages().length;
    assistantTextBeforeSend = assistantMessages().at(-1)?.innerText?.trim() || "";
    setComposerText(el, text);
    setStatus("Sending your words…");
    setTimeout(() => {
      const sent = clickButtonByLabel(["Send prompt", "Send message", "Send"]);
      if (!sent) {
        // Only press Enter when the composer is focused and has text.
        el.focus();
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
      }
      setStatus("Waiting for ChatGPT's reply…");
      waitForReplyAndReadAloud();
    }, 250);
  }

  function assistantMessages() {
    return [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  }

  function generating() {
    return !!document.querySelector('button[data-testid="stop-button"],button[aria-label*="Stop generating" i],[data-testid="stop-button"]');
  }

  async function waitForReplyAndReadAloud() {
    // Don't wait for assistant message text: ChatGPT's DOM can change and
    // the reply detector may fail even while the Read aloud control is present.
    // Poll the visible page for the button and click it as soon as it appears.
    const started = Date.now();
    const timeoutMs = 120000;
    while (running && Date.now() - started < timeoutMs) {
      const clicked = clickButtonByLabel(["Read aloud"]);
      if (clicked) {
        setStatus("Clicked Read aloud. Waiting before listening again…");
        // Avoid inspecting reply text/audio; simply allow playback time based on
        // the visible assistant response if available, then resume the mic.
        const latest = assistantMessages().at(-1);
        const replyText = latest?.innerText?.trim() || "";
        const waitMs = Math.min(120000, Math.max(8000, (replyText.length / 14) * 1000 + 3000));
        await new Promise(resolve => setTimeout(resolve, waitMs));
        if (!running) return;
        busy = false;
        setStatus("Listening for your next dictation…");
        scheduleRestart(700);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 700));
    }

    if (!running) return;
    setStatus("Couldn't find Read aloud yet. Listening again.");
    busy = false;
    scheduleRestart(1500);
  }

  function scheduleRestart(delay = 500) {
    clearTimeout(restartTimer);
    if (!running) return;
    restartTimer = setTimeout(startRecognition, delay);
  }

  function stopRecognition() {
    clearTimeout(silenceTimer);
    if (recognition) {
      try { recognition.onend = null; recognition.stop(); } catch {}
    }
    recognitionActive = false;
  }

  function startRecognition() {
    if (!running || busy || recognitionActive) return;
    if (!SpeechRecognition) {
      setStatus("Speech recognition isn't available in this browser.");
      running = false;
      return;
    }
    try {
      recognition = new SpeechRecognition();
      // ChatGPT's page language can be empty or unrelated to the user's speech.
      // Use a stable default so recognition doesn't inherit a surprising locale.
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition._seenFinals = new Set();
      recognition.onstart = () => { recognitionActive = true; setStatus("Listening to your microphone…"); };
      recognition.onresult = event => {
        // Rebuild the current interim phrase from all non-final results. Chrome
        // may revise interim results; appending each revision duplicates words.
        const interimParts = [];
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const phrase = (result[0]?.transcript || "").trim();
          if (!phrase) continue;
          if (result.isFinal) {
            const key = phrase.toLocaleLowerCase();
            if (!recognition._seenFinals) recognition._seenFinals = new Set();
            if (!recognition._seenFinals.has(key)) {
              pendingFinal += " " + phrase;
              recognition._seenFinals.add(key);
            }
          } else {
            interimParts.push(phrase);
          }
        }
        interim = interimParts.join(" ").trim();
        const spoken = (pendingFinal + " " + interim).replace(/\\s+/g, " ").trim();
        if (spoken) {
          setStatus("Hearing: " + spoken.slice(-90));
          clearTimeout(silenceTimer);
          silenceTimer = setTimeout(sendMessage, silenceSeconds * 1000 + 900);
        }
      };
      recognition.onnomatch = () => {
        setStatus("Didn't catch words. Keep the microphone selected and try speaking again.");
      };
      recognition.onerror = event => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setStatus("Microphone permission denied. Allow microphone access for ChatGPT.");
          running = false;
          return;
        }
        if (event.error !== "no-speech" && event.error !== "aborted") setStatus("Speech recognition: " + event.error);
      };
      recognition.onend = () => {
        recognitionActive = false;
        if (running && !busy) scheduleRestart(400);
      };
      recognition.start();
    } catch (error) {
      recognitionActive = false;
      setStatus("Couldn't start recognition: " + (error?.message || error));
      if (running) scheduleRestart(1500);
    }
  }

  function stopLoop() {
    running = false;
    busy = false;
    clearTimers();
    stopRecognition();
    setStatus("Stopped");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "START") {
      silenceSeconds = Math.min(5, Math.max(1, Number(message.silenceSeconds) || 2));
      running = true;
      busy = false;
      pendingFinal = "";
      interim = "";
      startRecognition();
      sendResponse({ status: "Starting microphone recognition…" });
    } else if (message.action === "STOP") {
      stopLoop();
      sendResponse({ status: "Stopped" });
    } else if (message.action === "STATUS") {
      sendResponse({ status: lastStatus });
    }
    return true;
  });
})();