(() => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const toggle = document.querySelector("#toggle");
  const auto = document.querySelector("#auto");
  const status = document.querySelector("#status");
  const preview = document.querySelector("#preview");
  const setStatus = text => { status.textContent = text; };
  let recognition = null, listening = false, finalText = "", interimText = "", silenceTimer = null, restartTimer = null;
  const sendQueue = [];
  let processingQueue = false;
  const SILENCE_MS = 3000;

  chrome.storage.local.get(["autoGenerate"], data => {
    if (typeof data.autoGenerate === "boolean") auto.checked = data.autoGenerate;
  });
  auto.addEventListener("change", () => chrome.storage.local.set({autoGenerate:auto.checked}));

  async function processSendQueue() {
    if (processingQueue) return;
    processingQueue = true;
    try {
      while (sendQueue.length) {
        const text = sendQueue[0];
        try {
          const tabs = await chrome.tabs.query({url:["https://inworld.ai/*","https://*.inworld.ai/*"]});
          const tab = tabs.find(t => t.active) || tabs[0];
          if (!tab?.id) throw new Error("Open an Inworld AI TTS tab in Chrome first.");
          const response = await chrome.tabs.sendMessage(tab.id, {type:"IVD_GENERATE",text});
          if (!response?.ok) throw new Error(response?.message || "Inworld could not receive the transcript.");
          sendQueue.shift();
          setStatus(sendQueue.length ? "Phrase sent. " + sendQueue.length + " phrase(s) queued." : "Phrase sent to Inworld.");
        } catch (e) {
          setStatus((e?.message || "Couldn't send transcript.") + " Retrying in 2 seconds; your phrase is saved.");
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    } finally {
      processingQueue = false;
    }
  }

  function sendTranscript(text) {
    if (!text.trim()) return;
    sendQueue.push(text.trim());
    setStatus("Phrase queued (" + sendQueue.length + ").");
    void processSendQueue();
  }

  function flush() {
    clearTimeout(silenceTimer);
    const text = [finalText, interimText].filter(Boolean).join(" ").trim();
    finalText = ""; interimText = "";
    if (!text) return;
    preview.textContent = text;
    if (auto.checked) sendTranscript(text);
    else setStatus("Transcript captured. Turn on auto-generate to send it to Inworld.");
  }

  function startRecognition() {
    if (!listening || !SpeechRecognition) return;
    const r = new SpeechRecognition();
    recognition = r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onstart = () => { if (listening) { toggle.textContent = "■ Stop dictation"; setStatus("Listening… you can switch to VRChat."); } };
    r.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const phrase = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += phrase + " ";
        else interim += phrase;
      }
      interimText = interim;
      const text = [finalText, interimText].filter(Boolean).join(" ").trim();
      if (text) preview.textContent = text;
      clearTimeout(silenceTimer);
      if (text && auto.checked) silenceTimer = setTimeout(flush, SILENCE_MS);
    };
    r.onerror = event => {
      setStatus("Speech recognition: " + event.error);
      if (["not-allowed","service-not-allowed","audio-capture"].includes(event.error)) {
        listening = false; toggle.textContent = "🎙 Start dictation";
      }
    };
    r.onend = () => {
      if (recognition === r) recognition = null;
      if (listening) {
        // Flush captured words before Chrome's automatic recognition restart.
        flush();
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => { if (listening && !recognition) startRecognition(); }, 300);
      } else {
        flush();
        toggle.textContent = "🎙 Start dictation";
        setStatus("Dictation stopped.");
      }
    };
    try { r.start(); }
    catch (e) {
      recognition = null; listening = false; toggle.textContent = "🎙 Start dictation";
      setStatus("Couldn't start speech recognition: " + e.message);
    }
  }

  toggle.addEventListener("click", () => {
    if (!SpeechRecognition) { setStatus("Speech recognition isn't supported in this Chrome version."); return; }
    if (listening) {
      listening = false; clearTimeout(silenceTimer); clearTimeout(restartTimer);
      if (recognition) { try { recognition.stop(); } catch {} } else flush();
      toggle.textContent = "🎙 Start dictation";
      setStatus("Stopping dictation…");
    } else {
      listening = true;
      startRecognition();
    }
  });
})();