(() => {
  if (window.__chatgptEchoGuardInstalled) return;
  window.__chatgptEchoGuardInstalled = true;

  let enabled = false;
  let audioCompareEnabled = false;
  let lastAssistantText = "";
  let lastUserText = "";
  let handledAssistantText = "";
  let lastResetAt = 0;
  let scanTimer = null;

  chrome.storage.local.get({ echoGuardEnabled: false, echoAudioCompareEnabled: false }, data => {
    enabled = !!data.echoGuardEnabled;
    audioCompareEnabled = !!data.echoAudioCompareEnabled;
    if (enabled || audioCompareEnabled) scheduleVoiceRestart();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.echoGuardEnabled) {
      enabled = !!changes.echoGuardEnabled.newValue;
      if (enabled) scheduleVoiceRestart();
    }
    if (area === "local" && changes.echoAudioCompareEnabled) {
      audioCompareEnabled = !!changes.echoAudioCompareEnabled.newValue;
      if (audioCompareEnabled) scheduleVoiceRestart();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "ECHO_RECOVERY_PROMPT") {
      const recoveryPrompt = "REPEAT MODE RECOVERY: You are a voice repeater. Resume repeating the user words exactly. Do not answer conversationally, explain, or add commentary. Repeat only the user words.";
      autoSendTranscript(recoveryPrompt);
    }
    if (message?.type === "ECHO_AUTO_SEND_TRANSCRIPT") autoSendTranscript(String(message.text || ""));
    if (message?.type === "ECHO_GUARD_NEW_CHAT") {
      const ok = clickNewChat();
      if (!ok) retryAudioNewChat();
      sendResponse({ ok });
    }
    return true;
  });


  let transcriptPanel = null;
  let localTranscriptText = "";
  let assistantTranscriptText = "";

  function ensureTranscriptPanel() {
    if (transcriptPanel?.isConnected) return transcriptPanel;
    transcriptPanel = document.createElement("section");
    transcriptPanel.id = "echo-guard-live-transcript";
    transcriptPanel.setAttribute("role", "status");
    transcriptPanel.style.cssText = [
      "position:fixed","right:18px","bottom:18px","z-index:2147483647",
      "width:min(360px,calc(100vw - 36px))","max-height:42vh","overflow:auto",
      "padding:14px","border:1px solid #7778","border-radius:14px",
      "background:Canvas","color:CanvasText","box-shadow:0 8px 32px #0004",
      "font:13px/1.45 system-ui,sans-serif"
    ].join(";");
    const heading = document.createElement("div");
    heading.textContent = "Echo Guard · Echo recovery";
    heading.style.cssText = "font-weight:700;margin-bottom:5px";
    const note = document.createElement("div");
    note.textContent = "Recovery prompts are sent only after a detected echo mismatch, with a cooldown and re-arm after a match. Sending may interrupt Voice Mode.";
    note.style.cssText = "opacity:.75;font-size:11px;margin-bottom:10px";
    const userLabel = document.createElement("div");
    userLabel.textContent = "Your words (local Whisper):";
    userLabel.style.fontWeight = "600";
    const userText = document.createElement("div");
    userText.id = "echo-guard-local-words";
    userText.textContent = "Waiting for speech…";
    userText.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;margin:3px 0 10px";
    const assistantLabel = document.createElement("div");
    assistantLabel.textContent = "ChatGPT audio transcript (local estimate):";
    assistantLabel.style.fontWeight = "600";
    const assistantText = document.createElement("div");
    assistantText.id = "echo-guard-assistant-words";
    assistantText.textContent = "Waiting for ChatGPT speech…";
    assistantText.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;margin:3px 0 10px";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy latest mic words";
    copy.style.cssText = "padding:6px 10px;border:1px solid #8888;border-radius:8px;background:transparent;color:inherit;cursor:pointer";
    copy.addEventListener("click", async () => {
      if (!localTranscriptText) return;
      try {
        await navigator.clipboard.writeText(localTranscriptText);
        copy.textContent = "Copied!";
        setTimeout(() => { if (copy.isConnected) copy.textContent = "Copy latest mic words"; }, 1200);
      } catch {
        copy.textContent = "Clipboard unavailable";
      }
    });
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Hide Echo Guard transcript helper");
    close.style.cssText = "position:absolute;right:8px;top:7px;border:0;background:transparent;color:inherit;font-size:20px;cursor:pointer";
    close.addEventListener("click", () => { transcriptPanel?.remove(); transcriptPanel = null; });
    transcriptPanel.append(heading,note,userLabel,userText,assistantLabel,assistantText,copy,close);
    document.documentElement.appendChild(transcriptPanel);
    return transcriptPanel;
  }

  function findComposer() {
    for (const selector of ['#prompt-textarea','[contenteditable="true"][data-placeholder]','[contenteditable="true"][role="textbox"]','textarea']) {
      const el=[...document.querySelectorAll(selector)].find(n=>n.getClientRects().length&&!n.disabled&&!n.readOnly&&!n.closest('[aria-hidden="true"]'));
      if(el)return el;
    }
    return null;
  }
  function autoSendTranscript(rawText,attempt=0) {
    const text=String(rawText||"").trim();
    if(!text||text.length<2)return;
    const composer=findComposer();
    if(!composer){
      if(attempt<12){setTimeout(()=>autoSendTranscript(text,attempt+1),500);return;}
      chrome.runtime.sendMessage({type:"ECHO_AUTO_SEND_STATUS",status:"unavailable",text,detail:"ChatGPT's text composer is not available. Voice Mode may need to be exited before text can be sent."}).catch(()=>{});
      return;
    }
    try {
      composer.focus();
      if(composer instanceof HTMLTextAreaElement||composer instanceof HTMLInputElement){
        const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer),"value")?.set;
        if(setter)setter.call(composer,text);else composer.value=text;
        composer.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));
      } else {
        composer.replaceChildren(); composer.textContent=text;
        composer.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:text}));
      }
      const send=[...document.querySelectorAll('[data-testid="send-button"],button[aria-label*="Send" i],button[aria-label*="Submit" i]')].find(b=>b.getClientRects().length&&!b.disabled);
      if(!send){chrome.runtime.sendMessage({type:"ECHO_AUTO_SEND_STATUS",status:"composer-filled",text,detail:"Transcript filled but Send was unavailable."}).catch(()=>{});return;}
      send.click();
      chrome.runtime.sendMessage({type:"ECHO_AUTO_SEND_STATUS",status:"sent",text,detail:"Locally transcribed words sent to ChatGPT as text."}).catch(()=>{});
    } catch(e){chrome.runtime.sendMessage({type:"ECHO_AUTO_SEND_STATUS",status:"error",text,detail:"Could not insert transcript: "+String(e?.message||e)}).catch(()=>{});}
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "ECHO_LOCAL_TRANSCRIPT") {
      localTranscriptText = String(message.text || "");
      ensureTranscriptPanel();
      const node = transcriptPanel.querySelector("#echo-guard-local-words");
      if (node) node.textContent = localTranscriptText || "No words recognized.";
    }
    if (message?.type === "ECHO_ASSISTANT_TRANSCRIPT") {
      assistantTranscriptText = String(message.text || "");
      ensureTranscriptPanel();
      const node = transcriptPanel.querySelector("#echo-guard-assistant-words");
      if (node) node.textContent = assistantTranscriptText || "No words recognized.";
      const userNode = transcriptPanel.querySelector("#echo-guard-local-words");
      if (userNode && message.status === "mismatch") {
        userNode.style.textDecoration = "underline wavy #d97706";
        userNode.title = "The locally recognized words differ from the locally recognized ChatGPT audio.";
      } else if (userNode) {
        userNode.style.textDecoration = "none";
        userNode.title = "";
      }
    }
  });

  const normalize = s => (s || "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  function isVisible(el) {
    return !!el && el.getClientRects().length > 0 &&
      getComputedStyle(el).visibility !== "hidden" &&
      getComputedStyle(el).display !== "none";
  }

  function textOf(el) {
    return (el?.innerText || el?.textContent || "").replace(/\\s+/g, " ").trim();
  }

  function getMessages(role) {
    return [...document.querySelectorAll('[data-message-author-role="' + role + '"]')]
      .filter(isVisible)
      .map(textOf)
      .filter(Boolean);
  }

  // Voice Mode may render live captions outside the normal chat-message list.
  // Only use fallback nodes that explicitly identify their speaker; guessing from
  // arbitrary page text could trigger a new chat based on unrelated UI text.
  function getVoiceTranscriptMessages(role) {
    const selectors = [
      '[data-testid*="transcript" i]',
      '[data-testid*="caption" i]',
      '[data-testid*="voice" i]',
      '[aria-live="polite"]',
      '[aria-live="assertive"]',
      '[role="log"]',
      '[class*="transcript" i]',
      '[class*="caption" i]'
    ];
    const found = new Set();
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!isVisible(el)) continue;
        const text = textOf(el);
        if (!text || text.length > 3000) continue;
        const meta = [
          el.getAttribute("aria-label") || "",
          el.getAttribute("title") || "",
          el.getAttribute("data-testid") || "",
          el.getAttribute("data-speaker") || "",
          el.getAttribute("data-role") || "",
          el.className?.toString?.() || "",
          el.parentElement?.getAttribute("aria-label") || "",
          el.parentElement?.getAttribute("data-testid") || "",
          el.parentElement?.className?.toString?.() || ""
        ].join(" ").toLowerCase();
        const userSpeaker = /(^|[\\s_-])(user|you|human|speaker-user|user-transcript)([\\s_-]|$)/.test(meta);
        const assistantSpeaker = /assistant|chatgpt|speaker-assistant|assistant-transcript/.test(meta);
        const matchesRole = role === "user" ? userSpeaker && !assistantSpeaker : assistantSpeaker;
        if (!matchesRole) continue;
        found.add(text);
      }
    }
    // Remove parent containers when they merely repeat the same transcript text.
    return [...found].filter(text => text.length > 0);
  }

  function getLatestTexts(role) {
    const normal = getMessages(role);
    if (normal.length) return { messages: normal, source: "chat-messages" };
    const voice = getVoiceTranscriptMessages(role);
    return { messages: voice, source: voice.length ? "voice-transcript" : "none" };
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
      if ((!enabled && !audioCompareEnabled) || attempts >= 10) return;
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
    if (!enabled && !audioCompareEnabled) return false;
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
      '[data-testid*="new-chat" i]',
      'button[aria-label*="New chat" i]',
      'button[aria-label*="New conversation" i]',
      '[role="button"][aria-label*="New chat" i]',
      '[role="button"][aria-label*="New conversation" i]',
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

  function retryAudioNewChat(attempt = 0) {
    if ((!enabled && !audioCompareEnabled) || attempt >= 40) {
      console.error("[Echo Guard] Audio-mode new-chat retries ended after 30 seconds.");
      return;
    }
    if (clickNewChat()) return;
    setTimeout(() => retryAudioNewChat(attempt + 1), 750);
  }

  function retryAutomaticNewChat(assistantText, attempt = 0) {
    // Keep retrying for up to 30 seconds while this same non-echo response is current.
    // ChatGPT's sidebar and its controls can render late or change during Voice Mode.
    if (!enabled || attempt >= 40) {
      console.error("[Echo Guard] Automatic new-chat retries ended after 30 seconds. Check whether ChatGPT's sidebar is available.");
      return;
    }
    if (assistantText !== lastAssistantText) return;
    if (clickNewChat()) return;
    setTimeout(() => retryAutomaticNewChat(assistantText, attempt + 1), 750);
  }

  function scan() {
    // Audio mode owns comparisons when active; avoid duplicate text-DOM resets.
    if (!enabled || audioCompareEnabled) return;

    const userResult = getLatestTexts("user");
    const assistantResult = getLatestTexts("assistant");
    const users = userResult.messages;
    const assistants = assistantResult.messages;
    if (!users.length || !assistants.length) {
      if (voiceModeLooksActive()) {
        const now = Date.now();
        if (!scan.lastVoiceDiagnostic || now - scan.lastVoiceDiagnostic > 10000) {
          scan.lastVoiceDiagnostic = now;
          console.debug("[Echo Guard] Voice Mode detected; transcript sources:", {
            user: userResult.source,
            assistant: assistantResult.source,
            userCount: users.length,
            assistantCount: assistants.length
          });
        }
      }
      return;
    }

    const userText = users[users.length - 1];
    const assistantText = assistants[assistants.length - 1];
    if (!userText || !assistantText) return;

    if (userText !== lastUserText) {
      lastUserText = userText;
      handledAssistantText = "";
    }
    if (assistantText === lastAssistantText) return;
    lastAssistantText = assistantText;

    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      if (!enabled || Date.now() - lastResetAt < 1200) return;
      const currentUsers = getLatestTexts("user").messages;
      const currentAssistants = getLatestTexts("assistant").messages;
      const latestUser = currentUsers[currentUsers.length - 1] || "";
      const latestAssistant = currentAssistants[currentAssistants.length - 1] || "";
      if (!latestUser || !latestAssistant || latestAssistant !== lastAssistantText) return;
      if (latestAssistant === handledAssistantText) return;

      const score = similarity(latestUser, latestAssistant);
      console.info("[Echo Guard] Settled transcript checked.", {
        score,
        source: { user: userResult.source, assistant: assistantResult.source },
        latestUser,
        latestAssistant
      });
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
