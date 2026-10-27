(() => {
  if (window.__audioWatchdogInstalled) return;
  window.__audioWatchdogInstalled = true;

  const defaults = { enabled: true, stallSeconds: 8, cooldownSeconds: 15 };
  let settings = { ...defaults };
  const state = new WeakMap();
  const now = () => Date.now();

  function loadSettings() {
    try {
      chrome.storage.local.get(defaults, result => {
        if (!chrome.runtime.lastError && result) settings = { ...defaults, ...result };
      });
    } catch (_) {}
  }
  loadSettings();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      for (const key of Object.keys(defaults)) {
        if (changes[key]) settings[key] = changes[key].newValue;
      }
    });
  } catch (_) {}

  function restart(media, info) {
    info.recovering = true;
    info.lastRecovery = now();
    const originalTime = media.currentTime;
    try { media.pause(); } catch (_) {}
    window.setTimeout(() => {
      try {
        // Restore the playback position in case the site's player reset it.
        if (Number.isFinite(originalTime) && Math.abs(media.currentTime - originalTime) > 1.5) {
          media.currentTime = originalTime;
        }
        const result = media.play();
        if (result && typeof result.catch === "function") result.catch(() => {});
      } catch (_) {}
      info.recovering = false;
      info.lastTime = media.currentTime;
      info.lastProgress = now();
    }, 350);
  }

  function check() {
    if (!settings.enabled || document.visibilityState === "prerender") return;
    const t = now();
    document.querySelectorAll("audio, video").forEach(media => {
      if (media.paused || media.ended || media.seeking || media.readyState < 2 || media.error) {
        state.set(media, { lastTime: media.currentTime, lastProgress: t, lastRecovery: (state.get(media) || {}).lastRecovery || 0, recovering: false });
        return;
      }
      let info = state.get(media);
      if (!info) {
        info = { lastTime: media.currentTime, lastProgress: t, lastRecovery: 0, recovering: false };
        state.set(media, info);
        return;
      }
      if (info.recovering) return;
      if (Math.abs(media.currentTime - info.lastTime) > 0.08) {
        info.lastTime = media.currentTime;
        info.lastProgress = t;
        return;
      }
      const stalledFor = t - info.lastProgress;
      const cooldownOver = t - info.lastRecovery >= Math.max(5, Number(settings.cooldownSeconds) || 15) * 1000;
      if (stalledFor >= Math.max(4, Number(settings.stallSeconds) || 8) * 1000 && cooldownOver) {
        restart(media, info);
      }
    });
  }

  window.setInterval(check, 2000);
  document.addEventListener("play", event => {
    const media = event.target;
    if (media instanceof HTMLMediaElement) state.set(media, { lastTime: media.currentTime, lastProgress: now(), lastRecovery: 0, recovering: false });
  }, true);
})();
