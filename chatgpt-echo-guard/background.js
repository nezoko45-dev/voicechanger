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
  if (message?.type === "ECHO_AUTO_SEND_TRANSCRIPT") {
    if (Number.isInteger(captureTabId)) chrome.tabs.sendMessage(captureTabId,message).catch(()=>{});
    return;
  }
  if (message?.type === "ECHO_AUTO_SEND_STATUS") {
    chrome.runtime.sendMessage({type:"ECHO_AUDIO_STATUS_UPDATE",status:message.status,detail:message.detail,text:message.text||""}).catch(()=>{});
    return;
  }
  if (message?.type === "ECHO_LOCAL_TRANSCRIPT" || message?.type === "ECHO_ASSISTANT_TRANSCRIPT") {
    if (Number.isInteger(captureTabId)) {
      chrome.tabs.sendMessage(captureTabId, message).catch(() => {});
    }
    if (message.type === "ECHO_ASSISTANT_TRANSCRIPT") {
      chrome.runtime.sendMessage({
        type: "ECHO_AUDIO_STATUS_UPDATE",
        status: message.status || "info",
        detail: { user: message.user || "", assistant: message.assistant || "", text: message.text || "" }
      }).catch(() => {});
    }
    return;
  }
  if (message?.type === "ECHO_AUDIO_MISMATCH") {
    // Mismatches are displayed for the user; do not restart or replace the chat.
    chrome.runtime.sendMessage({ type: "ECHO_AUDIO_STATUS_UPDATE", status: "info", detail: "Transcript mismatch detected; see the live transcript helper on the ChatGPT page." }).catch(() => {});
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
