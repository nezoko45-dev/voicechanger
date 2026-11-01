(() => {
  if (window.__voiceChangerPocketBridge) return;
  window.__voiceChangerPocketBridge = true;
  window.addEventListener("message", async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "voicechanger-pocket-tts-studio" || data.type !== "TRANSCRIPT") return;
    const text = String(data.text || "").trim();
    if (!text) return;
    try {
      const reply = await chrome.runtime.sendMessage({ action:"SEND_TRANSCRIPT", text });
      window.postMessage({ source:"voicechanger-pocket-tts-bridge", type:"RESULT", ok:!!reply?.ok, message:reply?.message || "Sent." }, location.origin);
    } catch {
      window.postMessage({ source:"voicechanger-pocket-tts-bridge", type:"RESULT", ok:false, message:"Extension bridge unavailable. Reload both tabs." }, location.origin);
    }
  });
})();