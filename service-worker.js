const FISH_AUDIO_HOST = "fish.audio";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "FISH_AUDIO_CLICK_AGAIN") return;

  (async () => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];

    if (!tab?.id || !tab.url) {
      sendResponse({ ok: false, message: "No active tab found. Open Fish Audio and try again." });
      return;
    }

    let host;
    try { host = new URL(tab.url).hostname.toLowerCase(); }
    catch {
      sendResponse({ ok: false, message: "The active tab does not appear to be a Fish Audio page." });
      return;
    }

    if (host !== FISH_AUDIO_HOST && !host.endsWith("." + FISH_AUDIO_HOST)) {
      sendResponse({ ok: false, message: "Switch to your Fish Audio tab first, then click this extension button." });
      return;
    }

    try {
      const result = await chrome.tabs.sendMessage(tab.id, { type: "FISH_AUDIO_CALL_AGAIN" });
      sendResponse(result || { ok: false, message: "Fish Audio did not respond. Refresh its tab and try again." });
    } catch (error) {
      sendResponse({ ok: false, message: "Could not reach the Fish Audio page. Refresh that tab and try again. " + (error?.message || "") });
    }
  })();

  return true;
});
