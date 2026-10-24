const FISH_AUDIO_HOST = "fish.audio";
let compareTabId = null;

async function activeFishAudioTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) return { error: "No active tab found. Open Fish Audio and try again." };
  let host;
  try { host = new URL(tab.url).hostname.toLowerCase(); }
  catch { return { error: "The active tab does not appear to be a Fish Audio page." }; }
  if (host !== FISH_AUDIO_HOST && !host.endsWith("." + FISH_AUDIO_HOST)) {
    return { error: "Switch to your Fish Audio tab first, then enable the clicker or transcript monitor." };
  }
  return { tab };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FISH_AUDIO_AUDIO_START") {
    startCompare(message.tabId).then(() => sendResponse({ ok: true, message: "Local transcript mismatch monitoring started." }),
      error => sendResponse({ ok: false, message: "Could not start local monitoring: " + String(error?.message || error) }));
    return true;
  }
  if (message?.type === "FISH_AUDIO_AUDIO_STOP") {
    stopCompare().then(() => sendResponse({ ok: true, message: "Local transcript mismatch monitoring stopped." }),
      error => sendResponse({ ok: false, message: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "FISH_AUDIO_AUTO_STATUS") {
    chrome.runtime.sendMessage({ type: "FISH_AUDIO_STATUS_UPDATE", automatic: !!message.automatic,
      mismatchRecoveryEnabled: !!message.mismatchRecoveryEnabled, message: message.message || "" }).catch(() => {});
    return;
  }
  if (message?.type === "FISH_AUDIO_TRANSCRIPT_MISMATCH") {
    if (Number.isInteger(compareTabId)) chrome.tabs.sendMessage(compareTabId, message).catch(() => {});
    return;
  }
  if (message?.type === "FISH_AUDIO_LOCAL_TRANSCRIPT" || message?.type === "FISH_AUDIO_COMPARE_STATUS") {
    chrome.runtime.sendMessage({ type: "FISH_AUDIO_STATUS_UPDATE", ...message }).catch(() => {});
    if (message.type === "FISH_AUDIO_COMPARE_STATUS" && message.status === "mismatch" && Number.isInteger(compareTabId)) {
      chrome.tabs.sendMessage(compareTabId, { type: "FISH_AUDIO_TRANSCRIPT_MISMATCH", user: message.user || "", assistant: message.assistant || "" }).catch(() => {});
    }
    return;
  }
  if (![ "FISH_AUDIO_AUTO_TOGGLE", "FISH_AUDIO_GET_STATUS", "FISH_AUDIO_CLICK_AGAIN", "FISH_AUDIO_AUTO_STOP", "FISH_AUDIO_MISMATCH_RECOVERY" ].includes(message?.type)) return;

  (async () => {
    const { tab, error } = await activeFishAudioTab();
    if (error) { sendResponse({ ok: false, automatic: false, message: error }); return; }
    try {
      const result = await chrome.tabs.sendMessage(tab.id, message);
      sendResponse(result || { ok: false, automatic: false, message: "Fish Audio did not respond. Refresh its tab and try again." });
    } catch (err) {
      sendResponse({ ok: false, automatic: false, message: "Could not reach Fish Audio. Refresh its tab and reload the extension. " + (err?.message || "") });
    }
  })();
  return true;
});

async function ensureOffscreen() {
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (!contexts.length) {
    await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification: "Transcribe microphone and Fish Audio output locally to detect repeater mismatches." });
  }
}
async function startCompare(tabId) {
  if (!Number.isInteger(tabId)) throw new Error("Open Fish Audio in a tab first.");
  compareTabId = tabId;
  await chrome.storage.local.set({ fishAudioCompareTabId: tabId, fishAudioCompareEnabled: true });
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  const result = await chrome.runtime.sendMessage({ type: "FISH_AUDIO_OFFSCREEN_START", streamId });
  if (!result?.ok) throw new Error(result?.error || "Could not start audio capture.");
  await chrome.tabs.sendMessage(tabId, { type: "FISH_AUDIO_MISMATCH_RECOVERY", enabled: true });
}
async function stopCompare() {
  await chrome.storage.local.set({ fishAudioCompareEnabled: false });
  try { await chrome.runtime.sendMessage({ type: "FISH_AUDIO_OFFSCREEN_STOP" }); } catch {}
  if (Number.isInteger(compareTabId)) chrome.tabs.sendMessage(compareTabId, { type: "FISH_AUDIO_MISMATCH_RECOVERY", enabled: false }).catch(() => {});
  compareTabId = null;
  await chrome.storage.local.remove("fishAudioCompareTabId");
}
chrome.runtime.onStartup.addListener(() => stopCompare());
chrome.runtime.onInstalled.addListener(() => stopCompare());
