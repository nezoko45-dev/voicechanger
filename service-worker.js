const OFFSCREEN_URL = "offscreen.html";
const TTS_URL = "tts.dev";
let creatingOffscreen = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  if (contexts.length) return;
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA"],
    justification: "Keep voice dictation running while the user switches apps; send completed speech to tts.dev."
  });
  try { await creatingOffscreen; } finally { creatingOffscreen = null; }
}

async function sendToTtsPage(action, text) {
  const allTabs = await chrome.tabs.query({});
  const tabs = allTabs.filter(t => {
    try {
      const host = new URL(t.url || "").hostname.toLowerCase();
      return host === TTS_URL || host.endsWith("." + TTS_URL);
    } catch { return false; }
  });
  if (!tabs.length) {
    const openHosts = allTabs.map(t => {
      try { return new URL(t.url || "").hostname; } catch { return ""; }
    }).filter(Boolean).filter((host, i, arr) => arr.indexOf(host) === i).slice(0, 8);
    return { ok: false, message: "I can't see a tab whose address ends in tts.dev. Open the actual tts.dev page in this same Chrome profile. Open tabs I can see: " + (openHosts.join(", ") || "none") };
  }
  const tab = tabs.find(t => t.active) || tabs[0];
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: action === "preview" ? "IVD_PREVIEW" : "IVD_GENERATE",
      text
    });
    return response || { ok: true, message: action === "preview" ? "Transcript preview sent to tts.dev." : 'Stream clicked on tts.dev.' };
  } catch (error) {
    return { ok: false, message: "Couldn't reach tts.dev. Refresh that tab after reloading the extension, then try again. " + (error?.message || "") };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "IVD_TOGGLE_LISTENING") {
    (async () => {
      try {
        await ensureOffscreen();
        const result = await chrome.runtime.sendMessage({ type: "IVD_OFFSCREEN_TOGGLE" });
        sendResponse(result || { listening: false, message: "Dictation engine did not respond. Reload the extension." });
      } catch (error) {
        sendResponse({ listening: false, message: "Could not start background dictation: " + (error?.message || error) });
      }
    })();
    return true;
  }
  if (message?.type === "IVD_BRIDGE_TO_ZALT") {
    (async () => {
      try { sendResponse(await sendToTtsPage(message.action, String(message.text || ""))); }
      catch (error) { sendResponse({ ok: false, message: error?.message || String(error) }); }
    })();
    return true;
  }
});
