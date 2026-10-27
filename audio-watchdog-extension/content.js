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
  let synthesisBusySince = 0;
  let speechPauseTimer = null;
  let lastSpeechRecycle = 0;

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

  function stopThenStart(reason, cancelSpeech, cooldownMs) {
    if (recoveryInProgress || !settings.enabled || !isRunning()) return;
    const time = now();
    if (time - lastRecovery < cooldownMs) return;
    recoveryInProgress = true;
    lastRecovery = time;

    const stop = $("stop");
    const start = $("start");
    const status = $("status");
    if (status) status.textContent = reason;

    // Use the page's actual buttons, preserving the page's microphone-permission flow.
    try { stop.click(); } catch (_) {}
    window.setTimeout(() => {
      if (cancelSpeech) {
        try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (_) {}
      }
      window.setTimeout(() => {
        try { if (start && !start.disabled) start.click(); } catch (_) {}
        lastTextChange = now();
        lastTranscript = ($("transcript") || {}).value || "";
        synthesisBusySince = 0;
        recoveryInProgress = false;
      }, 700);
    }, 250);
  }

  function recycleAfterSpeechPause() {
    if (!settings.enabled || !isRunning() || recoveryInProgress) return;
    // Short debounce after recognized text arrives: the recognition result is
    // final text, so this approximates the user having finished that phrase.
    stopThenStart("Audio Watchdog: speech detected. Restarting dictation after your pause…", false, 2500);
    lastSpeechRecycle = now();
  }

  function tick() {
    if (!settings.enabled || location.hostname !== "nezoko45-dev.github.io") return;
    const transcript = $("transcript");
    const status = $("status");
    if (!transcript || !status) return;

    const time = now();
    const text = transcript.value || "";
    if (text !== lastTranscript) {
      const previous = lastTranscript;
      lastTranscript = text;
      lastTextChange = time;

      // Only react when new text is appended/recognized, not when the reader
      // deletes text after speaking it. Debounce so a continuous sentence doesn't
      // cause repeated stop/start cycles.
      if (text.trim() && text.length > previous.length && isRunning()) {
        clearTimeout(speechPauseTimer);
        speechPauseTimer = window.setTimeout(recycleAfterSpeechPause, 1800);
      }
    }

    const statusText = status.textContent || "";
    if (statusText !== lastStatus) {
      lastStatus = statusText;
      statusChangedAt = time;
    }

    if (!isRunning() || recoveryInProgress) {
      synthesisBusySince = 0;
      return;
    }

    const threshold = Math.max(8, Number(settings.stallSeconds) || 20) * 1000;
    const synth = window.speechSynthesis;
    const synthesisBusy = !!(synth && (synth.speaking || synth.pending));
    if (synthesisBusy) {
      if (!synthesisBusySince) synthesisBusySince = time;
    } else {
      synthesisBusySince = 0;
    }

    // Fallback watchdog for a speech queue that remains wedged.
    if (synthesisBusySince && time - synthesisBusySince >= 45000) {
      clearTimeout(speechPauseTimer);
      stopThenStart("Audio Watchdog detected stuck speech. Clicking Stop, then Start…", true, Math.max(10000, Number(settings.cooldownSeconds) * 1000));
      return;
    }

    const transcriptStale = !!text.trim() && time - lastTextChange >= threshold;
    const statusSuggestsActive = /listening|queued for read-aloud|read-aloud/i.test(statusText);
    const statusStale = time - statusChangedAt >= threshold;
    if (transcriptStale && statusSuggestsActive && statusStale) {
      clearTimeout(speechPauseTimer);
      stopThenStart("Audio Watchdog detected stalled read-aloud. Clicking Stop, then Start…", true, Math.max(10000, Number(settings.cooldownSeconds) * 1000));
    }
  }

  window.setInterval(tick, 500);
})();
