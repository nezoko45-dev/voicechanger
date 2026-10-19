(() => {
  if (window.__elevenLabsVoiceDictationInstalled) return;
  window.__elevenLabsVoiceDictationInstalled = true;

  const messageQueue = [];
  let processingQueue = false;
  const visible = el => !!el && el.getClientRects().length > 0;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function findTextBox() {
    const candidates = [...document.querySelectorAll('textarea,input:not([type]),input[type="text"],[contenteditable="true"],[role="textbox"]')]
      .filter(el => !el.disabled && el.getAttribute("aria-disabled") !== "true" && visible(el));
    const score = el => {
      const attrs = [el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("data-placeholder"), el.getAttribute("name"), el.getAttribute("data-testid")].join(" ").toLowerCase();
      let n = 0;
      if (el.tagName === "TEXTAREA") n += 5;
      if (el.isContentEditable || el.getAttribute("role") === "textbox") n += 4;
      if (/text|speech|speak|script|voice|tts|prompt|type here|enter text/.test(attrs)) n += 8;
      if (/search|filter|email|password|voice name/.test(attrs)) n -= 12;
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

  function buttonLabels(button) {
    return [button.getAttribute("aria-label"), button.title, button.innerText, button.textContent, button.value, button.getAttribute("data-testid")]
      .filter(Boolean).map(s => s.trim());
  }

  function findGenerateButton(box) {
    const buttons = [...document.querySelectorAll("button,[role='button'],input[type='submit']")].filter(visible);
    const matches = buttons.filter(button => buttonLabels(button).some(label => /generate|synthesize|create speech/i.test(label)));
    if (!matches.length) return null;
    let ancestor = box;
    for (let depth = 0; ancestor && depth < 10; depth++, ancestor = ancestor.parentElement) {
      const nearby = matches.find(button => ancestor.contains(button));
      if (nearby) return nearby;
    }
    return matches.find(button => /generate speech|generate|synthesize|create speech/i.test(buttonLabels(button).join(" "))) || matches[0];
  }

  function isBusy(button) {
    if (!button) return true;
    const labels = buttonLabels(button).join(" ").toLowerCase();
    return button.disabled ||
      button.getAttribute("aria-disabled") === "true" ||
      button.getAttribute("aria-busy") === "true" ||
      /generating|processing|loading|synthesizing/.test(labels);
  }

  async function waitForReady(box, timeoutMs = 60000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const currentBox = box?.isConnected ? box : findTextBox();
      const button = currentBox ? findGenerateButton(currentBox) : null;
      if (currentBox && button && !isBusy(button)) return { box: currentBox, button };
      await sleep(1000);
    }
    throw new Error("Timed out waiting for ElevenLabs' text field and enabled Generate button. Check that the Text to Speech page is open and signed in.");
  }

  async function waitForGeneration(button, box) {
    // Some UI versions expose a busy state; wait for it to clear before replacing the text.
    const detectionDeadline = Date.now() + 12000;
    let sawBusy = false;
    while (Date.now() < detectionDeadline) {
      const currentButton = findGenerateButton(box) || button;
      if (isBusy(currentButton)) {
        sawBusy = true;
        break;
      }
      await sleep(300);
    }
    if (!sawBusy) {
      // Fallback for UI variants that don't disable or relabel the button.
      await sleep(4000);
      return;
    }
    const completionDeadline = Date.now() + 120000;
    while (Date.now() < completionDeadline) {
      const currentBox = box?.isConnected ? box : findTextBox();
      const currentButton = currentBox ? findGenerateButton(currentBox) : null;
      if (currentButton && !isBusy(currentButton)) return;
      await sleep(1000);
    }
    throw new Error("ElevenLabs still appears to be generating after 2 minutes. The phrase remains queued; check the page before continuing.");
  }

  async function generateSpeech(text) {
    const phrase = String(text || "").trim();
    if (!phrase) throw new Error("No transcript received");
    let { box, button } = await waitForReady(null);
    setText(box, phrase);

    // Allow the website's UI framework to update its state after text insertion.
    await sleep(300);
    ({ box, button } = await waitForReady(box, 30000));
    button.click();
    await waitForGeneration(button, box);
    return "Generated phrase on ElevenLabs";
  }

  async function processQueue() {
    if (processingQueue) return;
    processingQueue = true;
    try {
      while (messageQueue.length) {
        const item = messageQueue[0];
        try {
          const result = await generateSpeech(item.text);
          item.sendResponse({ ok: true, message: result });
          messageQueue.shift();
        } catch (error) {
          item.sendResponse({ ok: false, message: error?.message || "Unknown error" });
          // Remove this failed item after reporting the error. The side panel retains and retries it.
          messageQueue.shift();
        }
      }
    } finally {
      processingQueue = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "IVD_GENERATE" || typeof message.text !== "string") return;
    messageQueue.push({ text: message.text, sendResponse });
    void processQueue();
    return true;
  });
})();