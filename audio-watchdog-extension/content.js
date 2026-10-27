(() => {
  if (window.__audioWatchdogInstalled) return;
  window.__audioWatchdogInstalled = true;

  const defaults = { enabled: true, stallSeconds: 10, cooldownSeconds: 30 };
  let settings = { ...defaults };
  let lastTextChange = Date.now();
  let lastRecovery = 0;
  let recoveryInProgress = false;
  let lastTranscript = "";
  let lastStatus = "";
  let statusChangedAt = Date.now();
  let pausedSince = 0;
  let speakingSince = 0;

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
    if (time - lastRecovery < Math.max(15, Number(settings.cooldownSeconds) || 30) * 1000) return;
    recoveryInProgress = true;
    lastRecovery = time;
    clearTimeout(recover.timer);

    const stop = $("stop");
    const start = $("start");
    const status = $("status");
    if (status) status.textContent = "Audio Watchdog: " + reason + " Restarting dictation…";

    // Click the real page controls, then cancel any wedged speech queue.
    try { stop.click(); } catch (_) {}
    window.setTimeout(() => {
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_) {}
      window.setTimeout(() => {
        try { if (start && !start.disabled) start.click(); } catch (_) {}
        lastTextChange = now();
        lastTranscript = ($("transcript") || {}).value || "";
        pausedSince = 0;
        speakingSince = 0;
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

    if (!isRunning() || recoveryInProgress) {
      pausedSince = 0;
      speakingSince = 0;
      return;
    }

    const synth = window.speechSynthesis;
    const speaking = !!(synth && (synth.speaking || synth.pending));
    const paused = !!(synth && synth.paused);

    // speechSynthesis can remain "speaking" when playback has actually paused.
    if (paused) {
      if (!pausedSince) pausedSince = time;
      if (time - pausedSince >= 3000) {
        recover("Chrome reports read-aloud is paused for 3 seconds.");
        return;
      }
    } else {
      pausedSince = 0;
    }

    // A phrase that remains in the app's text box while synthesis stays busy
    // far longer than expected is another likely stuck-utterance signal.
    if (speaking && text.trim()) {
      if (!speakingSince) speakingSince = time;
      const maxBusyMs = Math.max(25000, Math.min(90000, text.length * 220));
      if (time - speakingSince >= maxBusyMs) {
        recover("Read-aloud stayed busy longer than expected with text still present.");
        return;
      }
    } else {
      speakingSince = 0;
    }

    const threshold = Math.max(8, Number(settings.stallSeconds) || 10) * 1000;
    const transcriptStale = !!text.trim() && time - lastTextChange >= threshold;
    const statusSuggestsActive = /listening|queued for read-aloud|read-aloud/i.test(statusText);
    const statusStale = time - statusChangedAt >= threshold;
    if (transcriptStale && statusSuggestsActive && statusStale) {
      recover("The transcript and page status appear stuck.");
    }
  }

  window.setInterval(tick, 750);
})();
