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
  let mismatchRecoveryEnabled = false;
  let lastMismatchAt = 0;
  const MISMATCH_COOLDOWN_MS = 15000;

  function findCallAgainButton() {
    const buttons = [...document.querySelectorAll(
      "button, [role='button'], input[type='button'], input[type='submit']"
    )].filter(el => visible(el));
    return buttons.find(el => /^call again[.!]?$/i.test(label(el))) ||
      buttons.find(el => /\bcall again\b/i.test(label(el))) || null;
  }

  function findEndCallButton() {
    const buttons = [...document.querySelectorAll(
      "button, [role='button'], input[type='button'], input[type='submit']"
    )].filter(el => visible(el));
    // Prefer an explicit End call / Hang up label. Fish Audio's red styling
    // varies by page theme, so use the accessible label rather than color alone.
    return buttons.find(el => /^(end call|endcall|hang up|hangup|stop call)[.!]?$/i.test(label(el))) ||
      buttons.find(el => /\\b(end call|endcall|hang up|hangup)\\b/i.test(label(el))) || null;
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
    if (message?.type === "FISH_AUDIO_MISMATCH_RECOVERY") {
      mismatchRecoveryEnabled = !!message.enabled;
      if (mismatchRecoveryEnabled) lastAction = "Local transcript mismatch recovery is enabled.";
      sendResponse({ ok: true, automatic, mismatchRecoveryEnabled, message: lastAction });
    } else if (message?.type === "FISH_AUDIO_TRANSCRIPT_MISMATCH") {
      const now = Date.now();
      if (!mismatchRecoveryEnabled) {
        sendResponse({ ok: false, message: "Mismatch detected, but transcript recovery is turned off." });
        return;
      }
      if (now - lastMismatchAt < MISMATCH_COOLDOWN_MS) {
        sendResponse({ ok: false, message: "Mismatch detected during cooldown; duplicate Call again suppressed." });
        return;
      }
      lastMismatchAt = now;
      const endCallButton = findEndCallButton();
      if (enabled(endCallButton)) {
        // End the current Fish Audio call first, then let the DOM observer
        // click Call again only after that button becomes available.
        if (!automatic) {
          automatic = true;
          observer = new MutationObserver(scan);
          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["disabled", "aria-disabled", "aria-busy", "aria-label", "title", "class", "style"]
          });
        }
        waitingForReset = true;
        endCallButton.click();
        lastAction = "Transcript mismatch detected. Clicked “End call”; waiting for “Call again” to appear.";
      } else {
        const button = findCallAgainButton();
        if (enabled(button)) {
          if (automatic && waitingForReset) {
            lastAction = "Transcript mismatch detected; already waiting for the automatic Call again cycle.";
          } else {
            waitingForReset = true;
            button.click();
            lastAction = "Transcript mismatch detected. No End call button found, so clicked “Call again” directly.";
          }
        } else {
          lastAction = "Transcript mismatch detected. No End call button found; waiting for “Call again” to become available.";
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
        }
      }
      chrome.runtime.sendMessage({ type: "FISH_AUDIO_AUTO_STATUS", automatic, mismatchRecoveryEnabled, message: lastAction }).catch(() => {});
      sendResponse({ ok: true, automatic, mismatchRecoveryEnabled, message: lastAction });
    } else if (message?.type === "FISH_AUDIO_AUTO_START") {
      sendResponse(start());
    } else if (message?.type === "FISH_AUDIO_AUTO_TOGGLE") {
      sendResponse(automatic ? stop() : start());
    } else if (message?.type === "FISH_AUDIO_GET_STATUS") {
      sendResponse({ ok: true, automatic, mismatchRecoveryEnabled, message: lastAction });
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
