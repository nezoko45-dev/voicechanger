chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action !== "SEND_TRANSCRIPT") return;
  (async () => {
    const tabs = await chrome.tabs.query({ url: "https://pocketweb.tools/voice-cloning*" });
    const target = tabs.find(tab => tab.id);
    if (!target) { sendResponse({ ok:false, message:"Open PocketWebTools Voice Cloning in another tab first." }); return; }
    try {
      const reply = await chrome.tabs.sendMessage(target.id, { action:"FILL_TTS_FIELD", text:String(message.text || "") });
      sendResponse(reply || { ok:true, message:"Transcript sent to PocketWebTools." });
    } catch {
      sendResponse({ ok:false, message:"Reload the PocketWebTools tab after installing the extension." });
    }
  })();
  return true;
});