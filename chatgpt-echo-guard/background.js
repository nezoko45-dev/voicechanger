// MV3 service worker: starts tab capture from the popup's user gesture and hosts
// the offscreen document that records separate mic/tab audio streams.
let captureTabId = null;
chrome.storage.local.get({ echoCaptureTabId: null }, data => { captureTabId = data.echoCaptureTabId; });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ECHO_AUDIO_START") {
    startAudioCompare(message.tabId).then(
      () => sendResponse({ ok: true }),
      error => sendResponse({ ok: false, error: String(error?.message || error) })
    );
    return true;
  }
  if (message?.type === "ECHO_AUDIO_STOP") {
    stopAudioCompare().then(() => sendResponse({ ok: true }), error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === "ECHO_AUDIO_MISMATCH") {
    // Compatibility only: spoken correction must never force a new chat.
    chrome.runtime.sendMessage({
      type: "ECHO_AUDIO_STATUS_UPDATE",
      status: "info",
      detail: "Mismatch detected; use buffered audio correction instead of opening a new chat."
    }).catch(() => {});
    return;
  }
  if (message?.type === "ECHO_AUDIO_STATUS") {
    chrome.runtime.sendMessage({ type: "ECHO_AUDIO_STATUS_UPDATE", status: message.status, detail: message.detail }).catch(() => {});
  }
});

async function ensureOffscreen() {
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (!contexts.length) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification: "Capture microphone and ChatGPT tab audio locally for offline echo comparison."
    });
  }
}

async function startAudioCompare(tabId) {
  if (!Number.isInteger(tabId)) throw new Error("Open ChatGPT in a tab first.");
  captureTabId = tabId;
  await chrome.storage.local.set({ echoCaptureTabId: tabId });
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({ type: "ECHO_OFFSCREEN_START", streamId });
  if (!response?.ok) throw new Error(response?.error || "Could not start local audio capture.");
  await chrome.storage.local.set({ echoAudioCompareEnabled: true });
}

async function stopAudioCompare() {
  await chrome.storage.local.set({ echoAudioCompareEnabled: false });
  try { await chrome.runtime.sendMessage({ type: "ECHO_OFFSCREEN_STOP" }); } catch {}
  captureTabId = null;
  await chrome.storage.local.remove("echoCaptureTabId");
}

chrome.runtime.onStartup.addListener(() => stopAudioCompare());
chrome.runtime.onInstalled.addListener(() => stopAudioCompare());
