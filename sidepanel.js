(() => {
  const status = document.querySelector("#status");
  const diagnostic = document.querySelector("#diagnostic");
  const toggle = document.querySelector("#toggle");
  const auto = document.querySelector("#auto");
  const preview = document.querySelector("#preview");

  const setStatus = message => { if (status) status.textContent = message; };
  function showFatalError(error) {
    if (diagnostic) {
      diagnostic.style.display = "block";
      diagnostic.textContent = "Dictation panel error: " + (error?.message || String(error)) +
        ". Reload the extension at chrome://extensions. If it persists, reinstall the extracted branch folder.";
    }
    setStatus("The dictation panel failed to initialize. See the error below.");
  }

  try {
    if (!toggle || !auto || !status || !preview) throw new Error("Panel HTML is missing a required control.");
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null, listening = false, finalText = "", interimText = "", silenceTimer = null, restartTimer = null;
    let lastPreviewAt = 0, previewRequest = 0, restartAttempts = 0;
    const sendQueue = [];
    let processingQueue = false;
    const SILENCE_MS = 3000;

    if (!SpeechRecognition) {
      setStatus("Speech recognition is unavailable in this browser. Use current Google Chrome and allow microphone access.");
    }

    if (chrome?.storage?.local) {
      chrome.storage.local.get(["autoGenerate"], data => {
        if (!chrome.runtime.lastError && typeof data?.autoGenerate === "boolean") auto.checked = data.autoGenerate;
      });
      auto.addEventListener("change", () => chrome.storage.local.set({autoGenerate:auto.checked}));
    }

    async function activeElevenLabsTab() {
      const tabs = await chrome.tabs.query({url:["https://elevenlabs.io/*","https://*.elevenlabs.io/*"]});
      return tabs.find(t => t.active) || tabs[0] || null;
    }

    async function showTranscriptOnPage(text) {
      const phrase = String(text || "").trim();
      if (!phrase) return;
      const requestId = ++previewRequest;
      try {
        const tab = await activeElevenLabsTab();
        if (!tab?.id) {
          setStatus("Transcript heard: “" + phrase + "” — open the ElevenLabs Text to Speech tab to show it there.");
          return;
        }
        const result = await chrome.tabs.sendMessage(tab.id, {type:"IVD_PREVIEW",text:phrase});
        if (requestId === previewRequest && !result?.ok) {
          setStatus("Transcript heard: “" + phrase + "” — couldn't put it in the ElevenLabs text field. " + (result?.message || "Refresh the ElevenLabs tab."));
        }
      } catch (error) {
        if (requestId === previewRequest) setStatus("Transcript heard: “" + phrase + "” — refresh the ElevenLabs tab, then try again. " + (error?.message || ""));
      }
    }

    async function processSendQueue() {
      if (processingQueue) return;
      processingQueue = true;
      try {
        while (sendQueue.length) {
          const text = sendQueue[0];
          try {
            const tab = await activeElevenLabsTab();
            if (!tab?.id) throw new Error("Open an ElevenLabs Text to Speech tab first.");
            const response = await chrome.tabs.sendMessage(tab.id, {type:"IVD_GENERATE",text});
            if (!response?.ok) throw new Error(response?.message || "Refresh the ElevenLabs tab and try again.");
            sendQueue.shift();
            setStatus("Submitted to ElevenLabs. " + (sendQueue.length ? sendQueue.length + " phrase(s) queued." : "Waiting for your next phrase."));
          } catch (error) {
            setStatus("Transcript captured but not sent: " + (error?.message || "unknown error") + " Retrying in 3 seconds.");
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }
      } finally { processingQueue = false; }
    }

    function sendTranscript(text) {
      const phrase = String(text || "").trim();
      if (!phrase) return;
      sendQueue.push(phrase);
      setStatus("Transcript captured: “" + phrase + "”. Sending to ElevenLabs…");
      void processSendQueue();
    }

    function flush() {
      clearTimeout(silenceTimer);
      const text = [finalText, interimText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      finalText = "";
      interimText = "";
      if (!text) return;
      preview.textContent = text;
      void showTranscriptOnPage(text);
      if (auto.checked) sendTranscript(text);
      else setStatus("Transcript captured: “" + text + "”. Auto-send is off; text is shown in ElevenLabs.");
    }

    function startRecognition() {
      if (!listening || !SpeechRecognition) return;
      const r = new SpeechRecognition();
      recognition = r;
      r.continuous = true;
      r.interimResults = true;
      r.lang = "en-US";
      r.onstart = () => {
        restartAttempts = 0;
        if (listening) {
          toggle.textContent = "■ Stop dictation";
          setStatus("Listening… speak naturally. If Chrome pauses recognition, it will restart automatically.");
          chrome.runtime.sendMessage({type:"IVD_DICTATION_STATUS",listening:true,message:"Listening…"});
        }
      };
      r.onresult = event => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const phrase = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalText += phrase + " ";
          else interim += phrase;
        }
        interimText = interim;
        const text = [finalText, interimText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
        if (text) {
          preview.textContent = text;
          if (Date.now() - lastPreviewAt > 250) {
            lastPreviewAt = Date.now();
            void showTranscriptOnPage(text);
          }
          clearTimeout(silenceTimer);
          if (auto.checked) silenceTimer = setTimeout(flush, SILENCE_MS);
        }
      };
      r.onerror = event => {
        const fatal = ["not-allowed","service-not-allowed","audio-capture"].includes(event.error);
        if (fatal) {
          listening = false;
          clearTimeout(restartTimer);
          toggle.textContent = "🎙 Start dictation";
          const explanation = event.error === "audio-capture"
            ? "Chrome can't access a microphone. Check Windows input device and microphone permissions."
            : "Microphone permission was denied. Allow microphone access for Chrome and try again.";
          setStatus("Dictation paused: " + explanation);
          chrome.runtime.sendMessage({type:"IVD_DICTATION_STATUS",listening:false,message:"Dictation paused: "+explanation});
        } else if (listening) {
          // Chrome commonly emits no-speech/aborted when its recognition session times out.
          // Keep the user-facing state active; onend below will restart the session.
          setStatus("Keeping dictation active… Chrome ended a recognition session (" + event.error + "); reconnecting.");
        }
      };
      r.onend = () => {
        if (recognition === r) recognition = null;
        if (listening) {
          // Only flush completed speech when Chrome rotates its recognition session.
          // Discard interim words so a routine reconnect doesn't submit partial phrases.
          clearTimeout(silenceTimer);
          const completed = finalText.trim();
          finalText = "";
          interimText = "";
          if (completed) {
            preview.textContent = completed;
            void showTranscriptOnPage(completed);
            if (auto.checked) sendTranscript(completed);
          }
          clearTimeout(restartTimer);
          restartAttempts += 1;
          const delay = Math.min(3000, 250 * restartAttempts);
          setStatus("Reconnecting microphone recognition… dictation remains ON.");
          chrome.runtime.sendMessage({type:"IVD_DICTATION_STATUS",listening:true,message:"Reconnecting… dictation remains ON."});
          restartTimer = setTimeout(() => {
            if (listening && !recognition) startRecognition();
          }, delay);
        } else {
          flush();
          toggle.textContent = "🎙 Start dictation";
          setStatus("Dictation stopped.");
          chrome.runtime.sendMessage({type:"IVD_DICTATION_STATUS",listening:false,message:"Dictation stopped."});
        }
      };
      try { r.start(); }
      catch (error) {
        recognition = null;
        listening = false;
        toggle.textContent = "🎙 Start dictation";
        setStatus("Couldn't start speech recognition: " + error.message);
      }
    }

    function toggleListening() {
      if (!SpeechRecognition) {
        setStatus("Speech recognition isn't supported here. Use current Chrome.");
        return {listening:false,message:"Speech recognition isn't supported here."};
      }
      if (listening) {
        listening = false;
        clearTimeout(silenceTimer);
        clearTimeout(restartTimer);
        if (recognition) { try { recognition.stop(); } catch {} } else flush();
        toggle.textContent = "🎙 Start dictation";
        setStatus("Stopping dictation…");
        return {listening:false,message:"Dictation stopping."};
      }
      listening = true;
      startRecognition();
      return {listening:true,message:"Dictation started. Speak a short phrase to test it."};
    }

    toggle.addEventListener("click", () => toggleListening());
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type !== "IVD_TOGGLE_LISTENING") return;
      sendResponse(toggleListening());
    });
    setStatus("Ready. Open ElevenLabs Text to Speech, then click Start dictation.");
  } catch (error) { showFatalError(error); }
})();
