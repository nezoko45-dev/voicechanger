const statusEl = document.getElementById("status");
async function send(action) {
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id || !tab.url?.startsWith("https://pocketweb.tools/voice-cloning")) {
      statusEl.textContent = "Open PocketWebTools Voice Cloning in the active tab first.";
      return;
    }
    const reply = await chrome.tabs.sendMessage(tab.id, { action });
    statusEl.textContent = reply?.message || "Command sent.";
  } catch (error) {
    statusEl.textContent = "Reload the Voice Cloning page, then try again.";
  }
}
document.getElementById("start").addEventListener("click", () => send("START"));
document.getElementById("stop").addEventListener("click", () => send("STOP"));
