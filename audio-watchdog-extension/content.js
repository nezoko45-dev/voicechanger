(() => {
  if (window.__audioWatchdogInstalled) return;
  window.__audioWatchdogInstalled = true;

  const defaults = { enabled: true, stallSeconds: 12, cooldownSeconds: 20 };
  let settings = { ...defaults };
  let lastTextChange = Date.now();
  let lastRecovery = 0;
  let recoveryInProgress = false;
  let lastTranscript = "";
  let activeSince = 0;
  let sawSpeechActivity = false;
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

    // Use the app's actual controls so its microphone-recognition state is reset too.
    try { stop.click(); } catch (_) {}
    window.setTimeout(() => {
      try {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
      } catch (_) {}
      window.setTimeout(() => {
        try {
          if (start && !start.disabled) start.click();
        } catch (_) {}
        lastTextChange = now();
        lastTranscript = ($("transcript") || {}).value || "";
        sawSpeechActivity = false;
        activeSince = 0;
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
      // A nonempty transcript indicates fresh recognized words that should be read and removed.
      if (text.trim()) {
        sawSpeechActivity = true;
        if (!activeSince) activeSince = now();
      } else {
        sawSpeechActivity = false;
        activeSince = 0;
      }
    }

    const statusText = status.textContent || "";
    if (statusText !== lastStatus) {
      lastStatus = statusText;
      statusChangedAt = now();
    }

    if (!isRunning() || recoveryInProgress) return;

    const synth = window.speechSynthesis;
    const speaking = !!(synth && (synth.speaking || synth.pending));
    if (speaking) {
      sawSpeechActivity = true;
      return;
    }

    // The app normally removes each phrase after it is spoken. If text remains
    // unchanged while the speech engine is idle, the read-aloud queue may be stuck.
    const threshold = Math.max(6, Number(settings.stallSeconds) || 12) * 1000;
    const transcriptStale = text.trim() && now() - lastTextChange >= threshold;
    const statusSuggestsListening = /listening|queued for read-aloud/i.test(statusText);
    const statusStale = now() - statusChangedAt >= threshold;
    if (transcriptStale && statusSuggestsListening && statusStale) {
      restartApp("Transcript stayed on the page while speech output was idle.");
    }
  }

  window.setInterval(tick, 1500);
})();
