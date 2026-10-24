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
