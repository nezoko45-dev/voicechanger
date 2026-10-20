(() => {
  const toggle = document.querySelector("#toggle");
  const statusText = document.querySelector("#status-text");
  const indicator = document.querySelector("#indicator");
  let listening = false;
  function render(active) {
    listening = active;
    toggle.textContent = active ? "■ Stop listening" : "▶ Start listening";
    toggle.classList.toggle("stop", active);
    indicator.classList.toggle("on", active);
  }
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    statusText.textContent = listening ? "Stopping dictation…" : "Starting microphone…";
    try {
      const result = await chrome.runtime.sendMessage({ type: "IVD_TOGGLE_LISTENING" });
      render(!!result?.listening);
      statusText.textContent = result?.message || (listening ? "Listening." : "Dictation stopped.");
    } catch (error) {
      statusText.textContent = "Could not toggle dictation: " + (error?.message || error);
    } finally { toggle.disabled = false; }
  });
  document.querySelector("#open-tts").addEventListener("click", async () => {
    try {
      const tabs = await chrome.tabs.query({ url: ["https://ttslab.dev/*"] });
      if (tabs.length) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
      } else await chrome.tabs.create({ url: "https://TTSLab.dev/" });
      statusText.textContent = "TTSLab.dev opened. Make sure its text box and Stream button are visible.";
    } catch (error) { statusText.textContent = "Couldn't open TTSLab.dev: " + (error?.message || error); }
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "IVD_OFFSCREEN_STATUS") {
      render(!!message.listening);
      statusText.textContent = message.message || (listening ? "Listening." : "Dictation stopped.");
    } else if (message?.type === "IVD_OFFSCREEN_TRANSCRIPT") {
      statusText.textContent = "Recognized: " + message.text;
    }
  });
})();
