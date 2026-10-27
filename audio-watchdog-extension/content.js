(() => {
  if (window.__audioWatchdogInstalled) return;
  window.__audioWatchdogInstalled = true;

  const defaults = { enabled: true, stallSeconds: 20, cooldownSeconds: 60 };
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

  function recover(reason) {
    if (recoveryInProgress || !settings.enabled || !isRunning()) return;
    const time = now();
    if (time - lastRecovery < Math.max(30, Number(settings.cooldownSeconds) || 60) * 1000) return;
    recoveryInProgress = true;
    lastRecovery = time;

    const stop = $("stop");
    const start = $("start");
    const status = $("status");
    if (status) status.textContent = "Audio Watchdog: " + reason + " Restarting dictation…";

    try { stop.click(); } catch (_) {}
    window.setTimeout(() => {
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_) {}
      window.setTimeout(() => {
        try { if (start && !start.disabled) start.click(); } catch (_) {}
        lastTextChange = now();
        lastTranscript = ($("transcript") || {}).value || "";
        recoveryInProgress = false;
      }, 700);
    }, 250);
  }

  function tick() {
    if (!settings.enabled || location.hostname !== "nezoko45-dev.github.io") return;
    const transcript = $("transcript");
    const status = $("status");
    if (!transcript || !status) return;

    const time = now();
    const text = transcript.value || "";
    if (text !== lastTranscript) {
      lastTranscript = text;
      lastTextChange = time;
    }

    const statusText = status.textContent || "";
    if (statusText !== lastStatus) {
      lastStatus = statusText;
      statusChangedAt = time;
    }

    if (!isRunning() || recoveryInProgress) return;

    // Do not restart after every phrase or just because speechSynthesis reports
    // "speaking": either behavior can make the mic indicator flash while silent.
    // Recover only when an actual phrase remains stuck in the transcript and the
    // app's status has stopped changing for the full threshold.
    const threshold = Math.max(10, Number(settings.stallSeconds) || 20) * 1000;
    const transcriptStale = !!text.trim() && time - lastTextChange >= threshold;
    const statusSuggestsActive = /listening|queued for read-aloud|read-aloud/i.test(statusText);
    const statusStale = time - statusChangedAt >= threshold;
    if (transcriptStale && statusSuggestsActive && statusStale) {
      recover("read-aloud text and status appear stuck.");
    }
  }

  window.setInterval(tick, 1000);
})();
