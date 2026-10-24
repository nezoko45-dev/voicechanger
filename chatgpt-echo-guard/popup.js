const enabled = document.getElementById("enabled");
const status = document.getElementById("status");
chrome.storage.local.get({ echoGuardEnabled: false }, data => {
  enabled.checked = data.echoGuardEnabled;
  status.textContent = data.echoGuardEnabled ? "Armed for ChatGPT Voice Mode." : "Not armed.";
});
enabled.addEventListener("change", () => {
  chrome.storage.local.set({ echoGuardEnabled: enabled.checked }, () => {
    status.textContent = enabled.checked ? "Armed for ChatGPT Voice Mode." : "Not armed.";
  });
});
document.getElementById("reset").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url || "")) {
    status.textContent = "Open ChatGPT in the active tab first.";
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "ECHO_GUARD_NEW_CHAT" }, () => {
    if (chrome.runtime.lastError) status.textContent = "Refresh the ChatGPT tab, then try again.";
    else status.textContent = "New chat requested.";
  });
});
