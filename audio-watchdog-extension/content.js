(() => {
  if (window.__audioWatchdogInstalled) return;
  window.__audioWatchdogInstalled = true;

  const defaults = { enabled: true, stallSeconds: 20, cooldownSeconds: 20 };
  let settings = { ...defaults };
  let lastTextChange = Date.now();
  let lastRecovery = 0;
  let recoveryInProgress = false;
  let lastTranscript = "";
  let lastStatus = "";
  let statusChangedAt = Date.now();

  const $ = id => document.getElementById(id);
  const now = () => Date.now();

  try {
    chrome.storage.local.get(defaults, result => {
      if (!chrome.runtime.lastError && result) settings = { ...defaults, ...result };
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      for (const key of Object.keys(defaults)) {
        if (changes[key]) settings[key] = changes[key].newValue;
      }
    });
  } catch (_) {}

  function isRunning() {
    const start = $("start");
    const stop = $("stop");
    return !!(start && stop && start.disabled && !stop.disabled);
  }

  function restartApp(reason) {
    if (recoveryInProgress || !settings.enabled || !isRunning()) return;
    if (now() - lastRecovery < Math.max(10, Number(settings.cooldownSeconds) || 20) * 1000) return;
    recoveryInProgress = true;
    lastRecovery = now();

    const stop = $("stop");
    const start = $("start");
    const status = $("status");
    if (status) status.textContent = "Audio Watchdog detected stalled read-aloud. Clicking Stop, then Start… " + reason;

    // Click the app's real controls; Stop resets its recognition session.
    try { stop.click(); } catch (_) {}
    window.setTimeout(() => {
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_) {}
      window.setTimeout(() => {
        try { if (start && !start.disabled) start.click(); } catch (_) {}
        lastTextChange = now();
        lastTranscript = ($("transcript") || {}).value || "";
        recoveryInProgress = false;
      }, 900);
    }, 300);
  }

  function tick() {
    if (!settings.enabled || location.hostname !== "nezoko45-dev.github.io") return;
    const transcript = $("transcript");
    const status = $("status");
    if (!transcript || !status) return;

    const text = transcript.value || "";
    if (text !== lastTranscript) {
      lastTranscript = text;
      lastTextChange = now();
    }

    const statusText = status.textContent || "";
    if (statusText !== lastStatus) {
      lastStatus = statusText;
      statusChangedAt = now();
    }

    if (!isRunning() || recoveryInProgress) return;

    // Do NOT rely on speechSynthesis.speaking being false: a broken output stream
    // can leave it stuck true. This page removes each phrase from the transcript
    // after successful playback, so unchanged text + unchanged status is the signal.
    const threshold = Math.max(8, Number(settings.stallSeconds) || 20) * 1000;
    const transcriptStale = !!text.trim() && now() - lastTextChange >= threshold;
    const statusSuggestsActive = /listening|queued for read-aloud|read-aloud/i.test(statusText);
    const statusStale = now() - statusChangedAt >= threshold;
    if (transcriptStale && statusSuggestsActive && statusStale) {
      restartApp("Text has not cleared and the page status has not changed.");
    }
  }

  window.setInterval(tick, 1500);
})();
