const enabled = document.getElementById("enabled");
const audioToggle = document.getElementById("audioToggle");
const stopAudio = document.getElementById("stopAudio");
const status = document.getElementById("status");

function setStatus(text) { status.textContent = text; }
chrome.storage.local.get({ echoGuardEnabled: false, echoAudioCompareEnabled: false }, data => {
  enabled.checked = data.echoGuardEnabled;
  audioToggle.textContent = data.echoAudioCompareEnabled ? "Live transcript helper is running" : "Start live transcript helper";
  setStatus(data.echoAudioCompareEnabled ? "Live transcript helper enabled." : "Transcript helper is off.");
});
enabled.addEventListener("change", () => {
  chrome.storage.local.set({ echoGuardEnabled: enabled.checked }, () => {
    setStatus(enabled.checked ? "Transcript fallback armed." : "Transcript fallback disarmed.");
  });
});
audioToggle.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url || "")) {
      setStatus("Open ChatGPT in this tab, then start audio comparison.");
      return;
    }
    setStatus("Starting live transcript capture…");
    const result = await chrome.runtime.sendMessage({ type: "ECHO_AUDIO_START", tabId: tab.id });
    if (!result?.ok) throw new Error(result?.error || "Could not start capture.");
    audioToggle.textContent = "Audio comparison is running";
    setStatus("Capture is running. Keep Voice Mode open and speak normally; the on-page panel shows local transcript estimates.");
  } catch (error) { setStatus("Could not start: " + error.message); }
});
stopAudio.addEventListener("click", async () => {
  try {
    await chrome.runtime.sendMessage({ type: "ECHO_AUDIO_STOP" });
    audioToggle.textContent = "Start live transcript helper";
    setStatus("Transcript capture stopped.");
  } catch (error) { setStatus("Could not stop capture: " + error.message); }
});
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "ECHO_AUDIO_STATUS_UPDATE") {
    const detail = typeof message.detail === "string" ? message.detail :
      message.detail?.user ? "Mic: " + message.detail.user + " | ChatGPT: " + message.detail.assistant :
      JSON.stringify(message.detail || "");
    if (message.status === "mismatch") setStatus("Transcript mismatch detected; see the on-page panel. " + detail);
    else if (message.status === "corrected") setStatus("Local transcript suggestion available. " + detail);
    else if (message.status === "match") setStatus("Local transcript estimates match. " + detail);
    else if (detail) setStatus(detail);
  }
});
