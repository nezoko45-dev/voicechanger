(() => {
  const TARGET = "Start a call";
  let enabled = false;
  let clickedThisAppearance = false;
  let observer = null;
  let lastStatus = "";
  const status = message => {
    if (message === lastStatus) return;
    lastStatus = message;
    try { chrome.runtime.sendMessage({type:"ELEVENLABS_AUTOCLICK_STATUS", message}); } catch {}
  };
  const norm = value => String(value || "").replace(/\\s+/g, " ").trim().toLowerCase();
  function findButton() {
    const candidates = [...document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')];
    return candidates.find(el => {
      const label = norm(el.innerText || el.textContent || el.getAttribute("aria-label") || el.value);
      return label === norm(TARGET) && !el.disabled && el.getAttribute("aria-disabled") !== "true" &&
        el.getClientRects().length > 0;
    }) || null;
  }
  function scan() {
    if (!enabled) return;
    const button = findButton();
    if (!button) { clickedThisAppearance = false; return; }
    if (clickedThisAppearance) return;
    clickedThisAppearance = true;
    status('Found “Start a call”; clicking once…');
    button.click();
    status('Clicked “Start a call”. Waiting for it to disappear before watching for the next call.');
  }
  async function refresh() {
    try {
      const data = await chrome.storage.local.get(["elevenLabsAutoClickEnabled"]);
      enabled = !!data.elevenLabsAutoClickEnabled;
      if (enabled) {
        if (!observer) {
          observer = new MutationObserver(scan);
          observer.observe(document.documentElement, {subtree:true,childList:true,attributes:true,characterData:true});
        }
        scan();
        status('Monitoring this ElevenLabs tab for “Start a call”.');
      } else {
        if (observer) observer.disconnect();
        observer = null;
        clickedThisAppearance = false;
      }
    } catch {}
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.elevenLabsAutoClickEnabled) void refresh();
  });
  void refresh();
})();