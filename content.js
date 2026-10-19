(() => {
  if (window.__inworldVoiceDictationInstalled) return;
  window.__inworldVoiceDictationInstalled = true;

  let generating = false;
  let lastGenerateAt = 0;
  const GENERATE_COOLDOWN_MS = 12000;
  const visible = el => !!el && el.getClientRects().length > 0;

  function findTextBox() {
    const candidates = [...document.querySelectorAll('textarea,input:not([type]),input[type="text"],[contenteditable="true"],[role="textbox"]')]
      .filter(el => !el.disabled && el.getAttribute("aria-disabled") !== "true" && visible(el));
    const score = el => {
      const attrs = [el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("data-placeholder"), el.getAttribute("name"), el.getAttribute("data-testid")].join(" ").toLowerCase();
      let n = 0;
      if (el.tagName === "TEXTAREA") n += 5;
      if (el.isContentEditable || el.getAttribute("role") === "textbox") n += 4;
      if (/text|speech|speak|script|voice|tts|prompt|type here|enter text/.test(attrs)) n += 8;
      if (/search|filter|email|password/.test(attrs)) n -= 10;
      return n;
    };
    return candidates.sort((a, b) => score(b) - score(a))[0] || null;
  }

  function setText(box, text) {
    box.focus();
    if (box.isContentEditable || box.getAttribute("contenteditable") === "true") {
      box.replaceChildren(document.createTextNode(text));
      box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      box.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const proto = box.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(box, text); else box.value = text;
    box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findGenerateButton(box) {
    const buttons = [...document.querySelectorAll("button,[role='button'],input[type='submit']")].filter(visible);
    const labels = b => [b.getAttribute("aria-label"), b.title, b.innerText, b.textContent, b.value, b.getAttribute("data-testid")]
      .filter(Boolean).map(s => s.trim());
    const matches = buttons.filter(b => labels(b).some(s => /generate/i.test(s)));
    if (!matches.length) return null;
    let ancestor = box;
    for (let depth = 0; ancestor && depth < 9; depth++, ancestor = ancestor.parentElement) {
      const nearby = matches.find(b => ancestor.contains(b));
      if (nearby) return nearby;
    }
    return matches[0];
  }

  async function generateSpeech(text) {
    if (!text.trim()) throw new Error("No transcript received");
    if (generating) throw new Error("A generation is already being prepared");
    const remaining = GENERATE_COOLDOWN_MS - (Date.now() - lastGenerateAt);
    if (remaining > 0) throw new Error("Cooldown: wait " + Math.ceil(remaining / 1000) + " seconds");
    generating = true;
    try {
      const box = findTextBox();
      if (!box) throw new Error("Couldn't find Inworld's TTS text box");
      setText(box, text.trim());
      let button = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        button = findGenerateButton(box);
        if (button) break;
      }
      if (!button) throw new Error("Transcript inserted, but no visible Generate button was found");
      for (let attempt = 0; attempt < 8 && (button.disabled || button.getAttribute("aria-disabled") === "true"); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        button = findGenerateButton(box) || button;
      }
      if (button.disabled || button.getAttribute("aria-disabled") === "true") {
        throw new Error("Transcript inserted, but Generate is disabled");
      }
      lastGenerateAt = Date.now();
      button.click();
      return "Generate clicked";
    } finally {
      generating = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "IVD_GENERATE" || typeof message.text !== "string") return;
    generateSpeech(message.text)
      .then(result => sendResponse({ ok: true, message: result }))
      .catch(error => sendResponse({ ok: false, message: error?.message || "Unknown error" }));
    return true;
  });
})();