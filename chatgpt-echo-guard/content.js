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
    // Echo mode means the assistant must repeat the actual words, not merely mention
    // some of the same words in a different sentence.
    const left = normalize(a);
    const right = normalize(b);
    if (!left || !right) return 0;
    return left === right ? 1 : 0;
  }

  function voiceModeLooksActive() {
    const buttons = [...document.querySelectorAll("button")].filter(el => el.getClientRects().length);
    const labels = buttons.map(b => [
      b.getAttribute("aria-label") || "",
      b.getAttribute("title") || "",
      b.innerText || ""
    ].join(" ").toLowerCase()).join(" | ");
    return /end voice|exit voice|stop voice|turn off voice|mute microphone|unmute microphone/.test(labels);
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
    // Prefer ChatGPT's stable test id, then accessible labels, then visible text.
    const preferred = [
      '[data-testid="create-new-chat-button"]',
      'button[aria-label*="New chat" i]',
      'button[aria-label*="New conversation" i]',
      'a[aria-label*="New chat" i]',
      'button[title*="New chat" i]',
      'button[title*="New conversation" i]'
    ];
    let target = null;
    for (const selector of preferred) {
      target = [...document.querySelectorAll(selector)]
        .find(el => el.getClientRects().length && !el.disabled);
      if (target) break;
    }
    if (!target) {
      const candidates = [...document.querySelectorAll("button, a, [role='button']")]
        .filter(el => el.getClientRects().length && !el.disabled);
      target = candidates.find(el => {
        const label = [
          el.getAttribute("aria-label") || "",
          el.getAttribute("title") || "",
          el.innerText || "",
          el.textContent || ""
        ].join(" ").toLowerCase().replace(/\s+/g, " ").trim();
        return /^(new chat|new conversation)(\b|$)/.test(label) ||
          /\b(new chat|new conversation)\b/.test(label);
      });
    }
    if (target) {
      target.click();
      lastResetAt = Date.now();
      handledAssistantText = "";
      lastAssistantText = "";
      lastUserText = "";
      console.info("[Echo Guard] Automatically opened a new chat after a non-echo response.");
      scheduleVoiceRestart();
      return true;
    }
    console.warn("[Echo Guard] New chat control not visible yet; automatic retry will continue.");
    return false;
  }

  function retryAutomaticNewChat(assistantText, attempt = 0) {
    if (!enabled || attempt >= 8) {
      console.error("[Echo Guard] Automatic new-chat retry limit reached. Check that ChatGPT's sidebar is available.");
      return;
    }
    if (assistantText !== lastAssistantText) return;
    if (clickNewChat()) return;
    setTimeout(() => retryAutomaticNewChat(assistantText, attempt + 1), 700);
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
      if (!enabled || Date.now() - lastResetAt < 1200) return;
      const currentUsers = getMessages("user");
      const currentAssistants = getMessages("assistant");
      const latestUser = currentUsers[currentUsers.length - 1] || "";
      const latestAssistant = currentAssistants[currentAssistants.length - 1] || "";
      if (!latestUser || !latestAssistant || latestAssistant !== lastAssistantText) return;
      if (latestAssistant === handledAssistantText) return;

      const score = similarity(latestUser, latestAssistant);
      console.info("[Echo Guard] Finished assistant transcript checked.", { score, latestUser, latestAssistant });
      if (score < 1) {
        console.warn("[Echo Guard] Response was not an exact echo; requesting a new chat.", { latestUser, latestAssistant });
        handledAssistantText = latestAssistant;
        retryAutomaticNewChat(latestAssistant);
      } else {
        handledAssistantText = latestAssistant;
      }
    }, 1800);
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(scan, 1200);
  scan();
})();
