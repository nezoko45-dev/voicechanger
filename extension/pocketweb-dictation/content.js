(() => {
  if (window.__pocketWebDictationInstalled) return;
  window.__pocketWebDictationInstalled = true;

  function showStatus(message, ok = true) {
    let node = document.getElementById("pocketweb-dictation-status");
    if (!node) {
      node = document.createElement("div");
      node.id = "pocketweb-dictation-status";
      Object.assign(node.style, {
        position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647",
        background: "#111827", color: "#fff", padding: "10px 14px",
        borderRadius: "10px", font: "13px system-ui,sans-serif", maxWidth: "360px",
        boxShadow: "0 4px 20px #0004"
      });
      document.documentElement.appendChild(node);
    }
    node.style.borderLeft = "4px solid " + (ok ? "#86efac" : "#fda4af");
    node.textContent = "VoiceChanger: " + message;
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly &&
      getComputedStyle(el).visibility !== "hidden";
  }

  function findTextBox() {
    const selectors = [
      "textarea",
      '[contenteditable="true"]',
      '[role="textbox"]',
      'input[type="text"]',
      "input:not([type])"
    ];
    const candidates = [...new Set(selectors.flatMap(s => [...document.querySelectorAll(s)]))].filter(isVisible);
    const score = el => {
      const hint = [
        el.getAttribute("placeholder"), el.getAttribute("aria-label"),
        el.getAttribute("name"), el.id, el.getAttribute("data-testid")
      ].join(" ").toLowerCase();
      let value = el.tagName === "TEXTAREA" ? 30 : (el.isContentEditable ? 20 : 0);
      if (/text|speech|prompt|script|message|content|tts/.test(hint)) value += 15;
      if (/search|voice|reference|file|name/.test(hint)) value -= 20;
      return value;
    };
    return candidates.sort((a, b) => score(b) - score(a))[0] || null;
  }

  function setText(el, text) {
    el.focus();
    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      el.textContent = text;
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text); else el.value = text;
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action !== "FILL_TTS_FIELD") return;
    const text = String(message.text || "").trim();
    if (!text) {
      showStatus("Transcript was empty.", false);
      sendResponse({ ok: false, message: "Transcript was empty." });
      return;
    }
    const box = findTextBox();
    if (!box) {
      showStatus("Could not find the TTS text box. Reload PocketWebTools and try again.", false);
      sendResponse({ ok: false, message: "Could not find a visible TTS text field on PocketWebTools." });
      return;
    }
    setText(box, text);
    showStatus("Complete transcript inserted into the TTS text field.");
    sendResponse({ ok: true, message: "Complete transcript inserted into PocketWebTools' TTS text field." });
  });
})();