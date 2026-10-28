const start = document.getElementById("start");
const stop = document.getElementById("stop");
const status = document.getElementById("status");
const silence = document.getElementById("silence");

async function send(action) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url || "")) {
    status.textContent = "Open ChatGPT in this tab first.";
    return;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action,
      silenceSeconds: Number(silence.value)
    });
    status.textContent = response?.status || (action === "START" ? "Starting…" : "Stopped");
  } catch {
    status.textContent = "Reload the ChatGPT tab, then try again.";
  }
}
start.addEventListener("click", () => send("START"));
stop.addEventListener("click", () => send("STOP"));
chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
  if (!tab?.id) return;
  try {
    const state = await chrome.tabs.sendMessage(tab.id, { action: "STATUS" });
    if (state?.status) status.textContent = state.status;
  } catch {}
});