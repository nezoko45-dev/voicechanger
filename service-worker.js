const FISH_AUDIO_HOST = "fish.audio";

async function activeFishAudioTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) {
    return { error: "No active tab found. Open Fish Audio and try again." };
  }
  let host;
  try { host = new URL(tab.url).hostname.toLowerCase(); }
  catch { return { error: "The active tab does not appear to be a Fish Audio page." }; }
  if (host !== FISH_AUDIO_HOST && !host.endsWith("." + FISH_AUDIO_HOST)) {
    return { error: "Switch to your Fish Audio tab first, then enable automatic clicking." };
  }
  return { tab };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["FISH_AUDIO_AUTO_TOGGLE", "FISH_AUDIO_GET_STATUS", "FISH_AUDIO_CLICK_AGAIN", "FISH_AUDIO_AUTO_STOP"].includes(message?.type)) return;

  (async () => {
    const { tab, error } = await activeFishAudioTab();
    if (error) {
      sendResponse({ ok: false, automatic: false, message: error });
      return;
    }
    const type = message.type === "FISH_AUDIO_CLICK_AGAIN"
      ? "FISH_AUDIO_CALL_AGAIN"
      : message.type;
    try {
      const result = await chrome.tabs.sendMessage(tab.id, { type });
      sendResponse(result || { ok: false, automatic: false, message: "Fish Audio did not respond. Refresh its tab and try again." });
    } catch (err) {
      sendResponse({ ok: false, automatic: false, message: "Could not reach Fish Audio. Refresh its tab and reload the extension. " + (err?.message || "") });
    }
  })();
  return true;
});
