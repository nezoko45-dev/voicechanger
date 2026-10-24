(() => {
  if (window.__chatgptEchoGuardInstalled) return;
  window.__chatgptEchoGuardInstalled = true;

  let enabled = false;
  let lastAssistantText = "";
  let lastUserText = "";
  let handledAssistantText = "";
  let lastResetAt = 0;
  let scanTimer = null;

  chrome.storage.local.get({ echoGuardEnabled: false }, data => {
    enabled = !!data.echoGuardEnabled;
    if (enabled) scheduleVoiceRestart();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.echoGuardEnabled) {
      enabled = !!changes.echoGuardEnabled.newValue;
      if (enabled) scheduleVoiceRestart();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "ECHO_GUARD_NEW_CHAT") {
      const ok = clickNewChat();
      sendResponse({ ok });
    }
    return true;
  });

  const normalize = s => (s || "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  function getMessages(role) {
    return [...document.querySelectorAll('[data-message-author-role="' + role + '"]')]
      .filter(el => el.getClientRects().length)
      .map(el => (el.innerText || el.textContent || "").trim())
      .filter(Boolean);
  }

  function similarity(a, b) {
    a = normalize(a); b = normalize(b);
    if (!a || !b) return 0;
    if (a === b || a.includes(b) || b.includes(a)) return 1;
    const A = new Set(a.split(" ").filter(Boolean));
    const B = new Set(b.split(" ").filter(Boolean));
    let common = 0;
    for (const word of A) if (B.has(word)) common++;
    const dice = (2 * common) / (A.size + B.size);
    // A transcript may have a couple of recognition differences, but a merely related reply
    // should not count as an echo.
    return dice;
  }

  function voiceModeLooksActive() {
    const buttons = [...document.querySelectorAll("button")].filter(el => el.getClientRects().length);
    const labels = buttons.map(b => [
      b.getAttribute("aria-label") || "",
      b.getAttribute("title") || "",
      b.innerText || ""
    ].join(" ").toLowerCase()).join(" | ");
    return /end voice|exit voice|stop voice|voice mode|turn off voice|mute microphone|unmute microphone/.test(labels);
  }

  function scheduleVoiceRestart() {
    // ChatGPT may take a few seconds to render the new-chat composer. Keep retrying,
    // but stop as soon as Voice Mode is already open.
    let attempts = 0;
    const tryStart = () => {
      if (!enabled || attempts >= 10) return;
      attempts++;
      if (voiceModeLooksActive()) {
        console.info("[Echo Guard] Voice Mode is already active.");
        return;
      }
      if (clickStartVoice()) return;
      setTimeout(tryStart, 900);
    };
    setTimeout(tryStart, 700);
  }

  function clickStartVoice() {
    if (!enabled) return false;
    const candidates = [...document.querySelectorAll("button, [role='button']")]
      .filter(el => el.getClientRects().length && !el.disabled);
    const target = candidates.find(el => {
      const label = [
        el.getAttribute("aria-label") || "",
        el.getAttribute("title") || "",
        el.innerText || "",
        el.textContent || ""
      ].join(" ").toLowerCase().replace(/\s+/g, " ").trim();
      return /^(start voice|start voice mode|voice mode|talk with voice|open voice mode|voice)(\b|$)/.test(label)
        || /\b(start voice|start voice mode|talk with voice|open voice mode)\b/.test(label);
    });
    if (!target) {
      console.warn("[Echo Guard] Start Voice button not found; click it manually if needed.");
      return false;
    }
    target.click();
    console.info("[Echo Guard] Clicked Start Voice.");
    return true;
  }

  function clickNewChat() {
    const candidates = [...document.querySelectorAll("button, a, [role='button']")]
      .filter(el => el.getClientRects().length);
    const target = candidates.find(el => {
      const label = [
        el.getAttribute("aria-label") || "",
        el.getAttribute("title") || "",
        el.innerText || "",
        el.textContent || ""
      ].join(" ").toLowerCase().replace(/\s+/g, " ").trim();
      return /^(new chat|new conversation)(\b|$)/.test(label) ||
        /\b(new chat|new conversation)\b/.test(label);
    });
    if (target) {
      target.click();
      lastResetAt = Date.now();
      handledAssistantText = "";
      lastAssistantText = "";
      lastUserText = "";
      // Give the new conversation UI time to render, then try to restart Voice Mode.
      scheduleVoiceRestart();
      return true;
    }
    // Common ChatGPT sidebar button can be icon-only; use a conservative title/aria-label check above.
    console.warn("[Echo Guard] Could not find the New chat button.");
    return false;
  }

  function scan() {
    if (!enabled) return;
    const users = getMessages("user");
    const assistants = getMessages("assistant");
    if (!users.length || !assistants.length) return;

    const userText = users[users.length - 1];
    const assistantText = assistants[assistants.length - 1];
    if (!userText || !assistantText) return;

    if (userText !== lastUserText) {
      lastUserText = userText;
      handledAssistantText = "";
    }
    if (assistantText === lastAssistantText) return;
    lastAssistantText = assistantText;

    // Wait until the assistant transcript has settled, rather than reacting to partial streaming text.
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      if (!enabled || Date.now() - lastResetAt < 5000) return;
      const currentUsers = getMessages("user");
      const currentAssistants = getMessages("assistant");
      const latestUser = currentUsers[currentUsers.length - 1] || "";
      const latestAssistant = currentAssistants[currentAssistants.length - 1] || "";
      if (!latestUser || !latestAssistant || latestAssistant !== lastAssistantText) return;
      if (latestAssistant === handledAssistantText) return;

      handledAssistantText = latestAssistant;
      const score = similarity(latestUser, latestAssistant);
      // Short utterances are especially prone to transcription mismatch. Require a very close
      // match for tiny utterances and a modest overlap for longer ones.
      const words = normalize(latestUser).split(" ").filter(Boolean).length;
      const threshold = words <= 3 ? 0.75 : 0.45;
      if (score < threshold) {
        console.warn("[Echo Guard] Assistant response did not look like an echo; starting a new chat.", { score, latestUser, latestAssistant });
        clickNewChat();
      }
    }, 1800);
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(scan, 1200);
  scan();
})();
