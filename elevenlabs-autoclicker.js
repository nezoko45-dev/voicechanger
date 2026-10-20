(() => {
  const TARGET = "start a call";
  let enabled = false;
  let clickedThisAppearance = false;
  let observers = [];
  let lastStatus = "";
  let scanQueued = false;
  const status = message => {
    if (message === lastStatus) return;
    lastStatus = message;
    try { chrome.runtime.sendMessage({type:"ELEVENLABS_AUTOCLICK_STATUS", message}); } catch {}
  };
  const norm = value => String(value || "").replace(/[\\u200B-\\u200D\\uFEFF]/g, "").replace(/\\s+/g, " ").trim().toLowerCase();
  function rootsAndElements() {
    const roots = [document];
    const elements = [];
    const seen = new Set();
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      for (const el of root.querySelectorAll("*")) {
        elements.push(el);
        if (el.shadowRoot && !seen.has(el.shadowRoot)) {
          seen.add(el.shadowRoot);
          roots.push(el.shadowRoot);
        }
      }
    }
    return {roots, elements};
  }
  function matchesTarget(el) {
    return [
      el.innerText,
      el.textContent,
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("data-testid"),
      el.value
    ].some(value => norm(value) === TARGET);
  }
  function findButton() {
    const {elements} = rootsAndElements();
    for (const el of elements) {
      if (!matchesTarget(el)) continue;
      const clickable = el.closest('button,[role="button"],[role="menuitem"],input[type="button"],input[type="submit"]') || el;
      if (clickable.disabled || clickable.getAttribute("aria-disabled") === "true") continue;
      if (clickable.getClientRects().length === 0) continue;
      const style = getComputedStyle(clickable);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      return clickable;
    }
    return null;
  }
  function scan() {
    scanQueued = false;
    if (!enabled) return;
    const button = findButton();
    if (!button) {
      clickedThisAppearance = false;
      status('Enabled — waiting for ElevenLabs “Start a call” button on this page.');
      return;
    }
    if (clickedThisAppearance) return;
    clickedThisAppearance = true;
    status('Found “Start a call”; clicking it now…');
    button.click();
    status('Clicked “Start a call”. Waiting for it to disappear before detecting the next one.');
  }
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    Promise.resolve().then(scan);
  }
  function attachObservers() {
    for (const observer of observers) observer.disconnect();
    observers = [];
    const {roots} = rootsAndElements();
    for (const root of roots) {
      const observer = new MutationObserver(queueScan);
      try {
        observer.observe(root, {subtree:true, childList:true, attributes:true, characterData:true});
        observers.push(observer);
      } catch {}
    }
  }
  async function refresh() {
    try {
      const data = await chrome.storage.local.get(["elevenLabsAutoClickEnabled"]);
      if (typeof data.elevenLabsAutoClickEnabled === "undefined") {
        await chrome.storage.local.set({elevenLabsAutoClickEnabled:true});
        enabled = true;
      } else {
        enabled = !!data.elevenLabsAutoClickEnabled;
      }
      if (enabled) {
        attachObservers();
        status('Autoclicker active on this page; checking for “Start a call”…');
        scan();
      } else {
        for (const observer of observers) observer.disconnect();
        observers = [];
        clickedThisAppearance = false;
        status("ElevenLabs autoclicker is off.");
      }
    } catch (error) {
      status("Autoclicker error: " + (error?.message || String(error)));
    }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.elevenLabsAutoClickEnabled) void refresh();
  });
  // Re-check periodically because some app controls are rendered in portals or late-loaded UI.
  setInterval(queueScan, 1000);
  void refresh();
})();