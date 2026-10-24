const enabled = document.getElementById("enabled");
const audioToggle = document.getElementById("audioToggle");
const stopAudio = document.getElementById("stopAudio");
const status = document.getElementById("status");

function setStatus(text) { status.textContent = text; }
chrome.storage.local.get({ echoGuardEnabled: false, echoAudioCompareEnabled: false }, data => {
  enabled.checked = data.echoGuardEnabled;
  audioToggle.textContent = data.echoAudioCompareEnabled ? "Audio comparison is running" : "Start local audio comparison";
  setStatus(data.echoAudioCompareEnabled ? "Audio comparison enabled." : "Not capturing audio.");
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
    setStatus("Starting microphone and tab audio capture…");
    const result = await chrome.runtime.sendMessage({ type: "ECHO_AUDIO_START", tabId: tab.id });
    if (!result?.ok) throw new Error(result?.error || "Could not start capture.");
    audioToggle.textContent = "Audio comparison is running";
    setStatus("Capturing audio. Speak a short phrase, then wait for ChatGPT to repeat it.");
  } catch (error) { setStatus("Could not start: " + error.message); }
});
stopAudio.addEventListener("click", async () => {
  try {
    await chrome.runtime.sendMessage({ type: "ECHO_AUDIO_STOP" });
    audioToggle.textContent = "Start local audio comparison";
    setStatus("Audio capture stopped.");
  } catch (error) { setStatus("Could not stop capture: " + error.message); }
});
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "ECHO_AUDIO_STATUS_UPDATE") {
    const detail = typeof message.detail === "string" ? message.detail :
      message.detail?.user ? "Mic: " + message.detail.user + " | ChatGPT: " + message.detail.assistant :
      JSON.stringify(message.detail || "");
    if (message.status === "mismatch") setStatus("Mismatch detected. " + detail);
    else if (message.status === "match") setStatus("Exact spoken-word match. " + detail);
    else if (detail) setStatus(detail);
  }
});
