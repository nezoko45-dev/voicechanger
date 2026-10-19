(() => {
  const status = document.querySelector("#status");
  const diagnostic = document.querySelector("#diagnostic");
  const toggle = document.querySelector("#toggle");
  const auto = document.querySelector("#auto");
  const preview = document.querySelector("#preview");

  function setStatus(message) {
    if (status) status.textContent = message;
  }
  function showFatalError(error) {
    if (diagnostic) {
      diagnostic.style.display = "block";
      diagnostic.textContent = "Dictation panel error: " + (error?.message || String(error)) +
        ". Try reloading the extension at chrome://extensions. If this persists, remove the extension and load the correct branch folder again.";
    }
    setStatus("The dictation panel failed to initialize. See the error below.");
  }

  try {
    if (!toggle || !auto || !status || !preview) {
      throw new Error("The panel HTML is missing a required control. Reinstall the latest branch.");
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null, listening = false, finalText = "", interimText = "", silenceTimer = null, restartTimer = null;
    const sendQueue = [];
    let processingQueue = false;
    const SILENCE_MS = 3000;

    if (chrome?.storage?.local) {
      chrome.storage.local.get(["autoGenerate"], data => {
        if (chrome.runtime.lastError) {
          setStatus("Ready. Settings could not be loaded; default options are active.");
          return;
        }
        if (typeof data?.autoGenerate === "boolean") auto.checked = data.autoGenerate;
      });
      auto.addEventListener("change", () => {
        chrome.storage.local.set({autoGenerate:auto.checked});
      });
    }

    async function processSendQueue() {
      if (processingQueue) return;
      processingQueue = true;
      try {
        while (sendQueue.length) {
          const text = sendQueue[0];
          try {
            const tabs = await chrome.tabs.query({url:["https://elevenlabs.io/*","https://*.elevenlabs.io/*"]});
            const tab = tabs.find(t => t.active) || tabs[0];
            if (!tab?.id) throw new Error("Open an ElevenLabs Text to Speech tab first.");
            const response = await chrome.tabs.sendMessage(tab.id, {type:"IVD_GENERATE",text});
            if (!response?.ok) throw new Error(response?.message || "ElevenLabs did not accept the transcript. Refresh the ElevenLabs tab.");
            sendQueue.shift();
            setStatus(sendQueue.length ? "Phrase submitted. " + sendQueue.length + " phrase(s) queued." : "Phrase submitted to ElevenLabs.");
          } catch (error) {
            setStatus((error?.message || "Couldn't send transcript.") + " Retrying in 3 seconds; this phrase remains queued.");
            await new Promise(resolve => setTimeout(resolve, 3000));
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
      finalText = "";
      interimText = "";
      if (!text) return;
      preview.textContent = text;
      if (auto.checked) sendTranscript(text);
      else setStatus("Transcript captured. Turn on auto-send to submit it to ElevenLabs.");
    }

    function startRecognition() {
      if (!listening || !SpeechRecognition) return;
      const r = new SpeechRecognition();
      recognition = r;
      r.continuous = true;
      r.interimResults = true;
      r.lang = "en-US";
      r.onstart = () => {
        if (listening) {
          toggle.textContent = "■ Stop dictation";
          setStatus("Listening… you can switch to VRChat. Keep this panel open.");
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
        const text = [finalText, interimText].filter(Boolean).join(" ").trim();
        if (text) preview.textContent = text;
        clearTimeout(silenceTimer);
        if (text && auto.checked) silenceTimer = setTimeout(flush, SILENCE_MS);
      };
      r.onerror = event => {
        setStatus("Speech recognition error: " + event.error + ". Check Chrome microphone permission and your microphone input.");
        if (["not-allowed","service-not-allowed","audio-capture"].includes(event.error)) {
          listening = false;
          toggle.textContent = "🎙 Start dictation";
        }
      };
      r.onend = () => {
        if (recognition === r) recognition = null;
        if (listening) {
          flush();
          clearTimeout(restartTimer);
          restartTimer = setTimeout(() => {
            if (listening && !recognition) startRecognition();
          }, 300);
        } else {
          flush();
          toggle.textContent = "🎙 Start dictation";
          setStatus("Dictation stopped.");
        }
      };
      try {
        r.start();
      } catch (error) {
        recognition = null;
        listening = false;
        toggle.textContent = "🎙 Start dictation";
        setStatus("Couldn't start speech recognition: " + error.message);
      }
    }

    function toggleListening() {
      if (!SpeechRecognition) {
        setStatus("Speech recognition isn't supported here. Update Chrome and try again.");
        return {listening:false,message:"Speech recognition isn't supported here."};
      }
      if (listening) {
        listening = false;
        clearTimeout(silenceTimer);
        clearTimeout(restartTimer);
        if (recognition) {
          try { recognition.stop(); } catch {}
        } else {
          flush();
        }
        toggle.textContent = "🎙 Start dictation";
        setStatus("Stopping dictation…");
        return {listening:false,message:"Dictation stopping."};
      }
      listening = true;
      startRecognition();
      return {listening:true,message:"Dictation started in the extension side panel."};
    }

    toggle.addEventListener("click", () => toggleListening());
    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== "IVD_TOGGLE_LISTENING") return;
        sendResponse(toggleListening());
      });
    }
    setStatus("Ready. Open ElevenLabs Text to Speech, then click Start dictation.");
  } catch (error) {
    showFatalError(error);
  }
})();
