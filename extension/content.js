(() => {
  if (window.__fishAudioCallAgainLoaded) return;
  window.__fishAudioCallAgainLoaded = true;

  let enabled = false;
  let delayMs = 1000;
  let armed = true;
  let pendingTimer = null;
  let lastButton = null;
  let lastClickAt = 0;
  let statusTimer = null;

  const normalize = value => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function findButton() {
    const candidates = [...document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')];
    return candidates.find(el => {
      const label = normalize(el.innerText || el.textContent || el.getAttribute('aria-label') || el.value);
      if (!/\bcall\s+again\b/.test(label)) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
        style.display !== 'none' && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    }) || null;
  }

  function isBusy(button) {
    if (!button) return true;
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') return true;
    const busy = button.closest('[aria-busy="true"]');
    if (busy) return true;
    return false;
  }

  function cancelPending() {
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  function clickButton(button, manual = false) {
    if (!button || !button.isConnected || isBusy(button)) return false;
    button.click();
    lastButton = button;
    lastClickAt = Date.now();
    armed = false;
    return true;
  }

  function schedule(button, manual = false) {
    cancelPending();
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (!manual && !enabled) return;
      const current = findButton();
      if (!current || (current !== button && !manual)) return;
      if (clickButton(current, manual)) {
        window.dispatchEvent(new CustomEvent('fish-audio-call-again-status', {detail:{clicked:true}}));
      }
    }, manual ? delayMs : delayMs);
  }

  function scan() {
    if (!enabled) return;
    const button = findButton();
    if (!button || isBusy(button)) {
      if (!button || isBusy(button)) {
        armed = true;
        lastButton = button;
      }
      cancelPending();
      return;
    }
    if (armed && Date.now() - lastClickAt > 600) schedule(button);
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, {subtree:true,childList:true,attributes:true,characterData:true,attributeFilter:['disabled','aria-disabled','aria-busy','class','style']});
  window.addEventListener('pageshow', scan);

  chrome.storage.local.get({autoClick:false,delaySeconds:1}).then(saved => {
    enabled = Boolean(saved.autoClick);
    delayMs = Math.max(0, Number(saved.delaySeconds) * 1000 || 0);
    scan();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.autoClick) enabled = Boolean(changes.autoClick.newValue);
    if (changes.delaySeconds) delayMs = Math.max(0, Number(changes.delaySeconds.newValue) * 1000 || 0);
    if (!enabled) cancelPending(); else scan();
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SETTINGS') {
      enabled = Boolean(message.enabled);
      delayMs = Math.max(0, Number(message.delayMs) || 0);
      if (!enabled) cancelPending(); else scan();
      sendResponse({ok:true,enabled});
      return true;
    }
    if (message.type === 'CLICK_ONCE') {
      delayMs = Math.max(0, Number(message.delayMs) || 0);
      const button = findButton();
      if (!button) { sendResponse({ok:false,error:'Could not find an enabled Call again button.'}); return true; }
      setTimeout(() => {
        const current = findButton();
        if (current && clickButton(current,true)) sendResponse({ok:true});
        else sendResponse({ok:false,error:'Call again is no longer available.'});
      }, delayMs);
      return true;
    }
  });
})();