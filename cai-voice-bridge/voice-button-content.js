(() => {
  if (window.__caiVoiceSvgToggleInstalled) return;
  window.__caiVoiceSvgToggleInstalled = true;

  // The exact Character.AI Voice toolbar SVG supplied by the user.
  const voicePath = 'M8 3a1 1 0 0 1 1 1v7.105l2-1.473V8a1 1 0 1 1 2 0v.158l2-1.474V6a1 1 0 0 1 1.78-.627l2.415-1.78a1 1 0 0 1 1.186 1.61L2.991 18.018a1 1 0 0 1-1.186-1.61L3 15.527V10a1 1 0 1 1 2 0v4.053l2-1.474V4a1 1 0 0 1 1-1';
  const matchesVoiceSvg = svg => {
    const paths = [...(svg?.querySelectorAll('path') || [])];
    return paths.some(p => (p.getAttribute('d') || '').startsWith(voicePath));
  };
  function findVoiceButton() {
    const exact = [...document.querySelectorAll('svg')].find(matchesVoiceSvg);
    if (!exact) return null;
    return exact.closest('button,[role="button"]');
  }
  function toggle() {
    const b = findVoiceButton();
    if (!b) {
      console.warn('[c.ai Voice SVG] exact Voice button SVG not found on this state/page');
      return false;
    }
    b.click();
    console.log('[c.ai Voice SVG] toggled Character.AI Voice button using supplied SVG signature');
    return true;
  }
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.action === 'CAI_TOGGLE_VOICE_SVG') sendResponse({ok: toggle()});
  });
  // Optional 5-second keepalive toggling, explicitly started from extension popup.
  let keepalive = null;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.action === 'CAI_VOICE_KEEPALIVE') {
      clearInterval(keepalive);
      if (msg.enabled) keepalive = setInterval(toggle, 5000);
      sendResponse({ok: true, enabled: !!msg.enabled});
    }
  });
})();