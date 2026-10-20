(() => {
  if (window.__fishAudioCallAgainInstalled) return;
  window.__fishAudioCallAgainInstalled = true;

  const visible = el => !!el && el.getClientRects().length > 0;
  const label = el => [
    el.innerText, el.textContent, el.value,
    el.getAttribute("aria-label"), el.getAttribute("title")
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  let automatic = false;
  let observer = null;
  let waitingForReset = false;
  let lastAction = "Automatic clicker is stopped.";

  function findCallAgainButton() {
    const buttons = [...document.querySelectorAll(
      "button, [role='button'], input[type='button'], input[type='submit']"
    )].filter(el => visible(el));
    return buttons.find(el => /^call again[.!]?$/i.test(label(el))) ||
      buttons.find(el => /\bcall again\b/i.test(label(el))) || null;
  }

  function enabled(button) {
    return !!button && !button.disabled &&
      button.getAttribute("aria-disabled") !== "true" &&
      button.getAttribute("aria-busy") !== "true";
  }

  function scan() {
    if (!automatic) return;
    const button = findCallAgainButton();
    if (!button || !enabled(button)) {
      // Re-arm only after the current action has visibly reset.
      waitingForReset = false;
      return;
    }
    if (waitingForReset) return;

    waitingForReset = true;
    button.click();
    lastAction = 'Automatically clicked “Call again”. Waiting for the next button cycle.';
    chrome.runtime.sendMessage({
      type: "FISH_AUDIO_AUTO_STATUS",
      automatic: true,
      message: lastAction
    }).catch(() => {});
  }

  function start() {
    if (!automatic) {
      automatic = true;
      waitingForReset = false;
      observer = new MutationObserver(scan);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["disabled", "aria-disabled", "aria-busy", "aria-label", "title", "class", "style"]
      });
    }
    scan();
    if (!waitingForReset) lastAction = 'Watching Fish Audio for an enabled “Call again” button.';
    return { ok: true, automatic, message: lastAction };
  }

  function stop() {
    automatic = false;
    if (observer) observer.disconnect();
    observer = null;
    waitingForReset = false;
    lastAction = "Automatic clicker stopped.";
    return { ok: true, automatic, message: lastAction };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "FISH_AUDIO_AUTO_TOGGLE") {
      sendResponse(automatic ? stop() : start());
    } else if (message?.type === "FISH_AUDIO_GET_STATUS") {
      sendResponse({ ok: true, automatic, message: lastAction });
    } else if (message?.type === "FISH_AUDIO_AUTO_STOP") {
      sendResponse(stop());
    } else if (message?.type === "FISH_AUDIO_CALL_AGAIN") {
      const button = findCallAgainButton();
      if (!enabled(button)) {
        sendResponse({ ok: false, message: 'Could not find an enabled “Call again” button.' });
      } else {
        button.click();
        sendResponse({ ok: true, message: 'Clicked “Call again”.' });
      }
    }
  });
})();
