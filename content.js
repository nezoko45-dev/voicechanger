(() => {
  if (window.__fishAudioCallAgainInstalled) return;
  window.__fishAudioCallAgainInstalled = true;

  const visible = el => !!el && el.getClientRects().length > 0;
  const label = el => [
    el.innerText,
    el.textContent,
    el.value,
    el.getAttribute("aria-label"),
    el.getAttribute("title")
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  function findCallAgainButton() {
    const buttons = [...document.querySelectorAll(
      "button, [role='button'], input[type='button'], input[type='submit']"
    )].filter(el => visible(el) && !el.disabled &&
      el.getAttribute("aria-disabled") !== "true");

    return buttons.find(el => /^call again[.!]?$/i.test(label(el))) ||
      buttons.find(el => /\bcall again\b/i.test(label(el))) ||
      null;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "FISH_AUDIO_CALL_AGAIN") return;
    const button = findCallAgainButton();
    if (!button) {
      sendResponse({
        ok: false,
        message: 'Could not find an enabled “Call again” button. Open the Fish Audio page where that button is visible, then try again.'
      });
      return;
    }

    button.click();
    sendResponse({ ok: true, message: 'Clicked “Call again”.' });
  });
})();
