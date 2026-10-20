(() => {
  if (window.__ttsDevDictationInstalled) return;
  window.__ttsDevDictationInstalled = true;

  const visible = el => !!el && el.getClientRects().length > 0;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let generating = false;
  let generationQueue = Promise.resolve();
  let lastSubmittedText = "";
  let lastSubmittedAt = 0;

  function attrs(el) {
    return [el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("data-placeholder"),
      el.getAttribute("name"), el.getAttribute("data-testid"), el.getAttribute("title")]
      .filter(Boolean).join(" ").toLowerCase();
  }

  function findTextBox() {
    const candidates = [...document.querySelectorAll('textarea,input:not([type]),input[type="text"],[contenteditable="true"],[role="textbox"],[data-slate-editor="true"],[data-lexical-editor="true"]')]
      .filter(el => !el.disabled && el.getAttribute("aria-disabled") !== "true" && visible(el));
    const score = el => {
      const a = attrs(el);
      let n = 0;
      if (el.tagName === "TEXTAREA") n += 8;
      if (el.isContentEditable || el.getAttribute("role") === "textbox" || el.hasAttribute("data-slate-editor") || el.hasAttribute("data-lexical-editor")) n += 4;
      if (/text|speech|script|prompt|type here|enter text|write|say|input/.test(a)) n += 10;
      if (/search|filter|email|password|voice name/.test(a)) n -= 15;
      return n;
    };
    return candidates.sort((a, b) => score(b) - score(a))[0] || null;
  }

  function setText(box, text) {
    box.focus();
    if (box.isContentEditable || box.getAttribute("contenteditable") === "true" || box.hasAttribute("data-slate-editor") || box.hasAttribute("data-lexical-editor")) {
      box.replaceChildren(document.createTextNode(text));
    } else {
      const proto = box.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(box, text);
      else box.value = text;
    }
    box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function buttonText(el) {
    return [el.innerText, el.textContent, el.value, el.getAttribute("aria-label"), el.title]
      .filter(Boolean).join(" ").replace(/\\s+/g, " ").trim();
  }

  function findStreamButton() {
    const buttons = [...document.querySelectorAll("button,[role='button'],input[type='submit'],input[type='button']")].filter(visible);
    const exact = buttons.find(el => /^stream$/i.test(buttonText(el)));
    if (exact) return exact;
    const matches = buttons.filter(el => /\\bstream\\b/i.test(buttonText(el)) && !/streaming settings|stream history|stream key/i.test(buttonText(el)));
    return matches.sort((a, b) => buttonText(a).length - buttonText(b).length)[0] || null;
  }

  const disabled = el => !el || el.disabled || el.getAttribute("aria-disabled") === "true" || el.getAttribute("aria-busy") === "true";

  async function waitForBox(timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const box = findTextBox();
      if (box) return box;
      await sleep(250);
    }
    throw new Error("Couldn't find a visible text-entry box on tts.dev. Make sure the TTS page is fully loaded.");
  }

  async function preview(text) {
    if (generating) return;
    const box = await waitForBox(10000);
    if (!generating) setText(box, text);
  }

  async function generateOne(phrase) {
    if (!phrase) throw new Error("No transcript received.");
    generating = true;
    try {
      const box = await waitForBox(30000);
      setText(box, phrase);
      await sleep(200);

      const deadline = Date.now() + 15000;
      let button = null;
      while (Date.now() < deadline) {
        button = findStreamButton();
        if (button && !disabled(button)) break;
        await sleep(250);
      }
      if (!button || disabled(button)) {
        throw new Error('Text was entered, but the enabled "Stream" button was not found on tts.dev. Check the page layout and try again.');
      }
      button.click();
      return { ok: true, message: 'Transcript entered and "Stream" clicked on tts.dev. Still listening for the next sentence.' };
    } finally {
      generating = false;
    }
  }

  function generate(text) {
    const phrase = String(text || "").trim();
    if (!phrase) return Promise.reject(new Error("No transcript received."));
    const now = Date.now();
    if (phrase === lastSubmittedText && now - lastSubmittedAt < 10000) {
      return Promise.resolve({ ok: true, message: "Duplicate transcript ignored; this sentence was already submitted." });
    }
    lastSubmittedText = phrase;
    lastSubmittedAt = now;
    const task = generationQueue.then(() => generateOne(phrase));
    generationQueue = task.catch(() => {});
    return task;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "IVD_PREVIEW" && typeof message.text === "string") {
      preview(message.text).then(() => sendResponse({ ok: true, message: "Live transcript preview entered into tts.dev." }))
        .catch(error => sendResponse({ ok: false, message: error?.message || String(error) }));
      return true;
    }
    if (message?.type === "IVD_GENERATE" && typeof message.text === "string") {
      generate(message.text).then(sendResponse)
        .catch(error => sendResponse({ ok: false, message: error?.message || String(error) }));
      return true;
    }
  });
})();
