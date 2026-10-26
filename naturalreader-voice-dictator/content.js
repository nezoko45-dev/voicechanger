(() => {
  if (window.__naturalReaderDictatorLoaded) return;
  window.__naturalReaderDictatorLoaded = true;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const state = { recognition: null, listening: false, suppressRestart: false, userStopped: false, restartTimer: null, finalText: "", sessionBase: "", timer: null, lastSent: "", autoPlay: true, clearOnStart: true, clearAfterPlayback: true, playbackPending: false };
  const $ = (id) => document.getElementById(id);

  const panel = document.createElement("section");
  panel.id = "nr-voice-dictator";
  panel.innerHTML = `
    <div class="nrvd-head"><strong>Voice Dictator</strong><button id="nrvd-hide" title="Hide panel">−</button></div>
    <div class="nrvd-row"><button id="nrvd-start">🎙 Start dictation</button><button id="nrvd-stop" disabled>Stop</button></div>
    <label><input id="nrvd-clear" type="checkbox" checked> Clear text field when starting</label>
    <label><input id="nrvd-play" type="checkbox" checked> Auto-press Play after a pause</label>
    <label><input id="nrvd-clear-after" type="checkbox" checked> Clear text after playback finishes</label>
    <div id="nrvd-status" role="status">Ready. Start dictation, then speak.</div>
    <div class="nrvd-foot">Uses Chrome speech recognition. Microphone permission may be required.</div>
  `;
  const style = document.createElement("style");
  style.textContent = `
    #nr-voice-dictator{position:fixed;z-index:2147483647;right:18px;bottom:18px;width:280px;background:#fff;color:#172033;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 8px 30px #0003;padding:12px;font:13px/1.4 system-ui,sans-serif}
    #nr-voice-dictator *{box-sizing:border-box} #nr-voice-dictator .nrvd-head,#nr-voice-dictator .nrvd-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
    #nr-voice-dictator button{cursor:pointer;border:0;border-radius:7px;padding:8px 10px;background:#2563eb;color:white;font-weight:600}
    #nr-voice-dictator button:disabled{opacity:.45;cursor:default} #nr-voice-dictator #nrvd-hide{background:#e2e8f0;color:#172033;padding:2px 8px}
    #nr-voice-dictator label{display:block;margin:7px 0;color:#334155} #nr-voice-dictator label input{vertical-align:middle}
    #nr-voice-dictator #nrvd-status{background:#f1f5f9;border-radius:7px;padding:8px;margin-top:8px;overflow-wrap:anywhere}
    #nr-voice-dictator .nrvd-foot{font-size:11px;color:#64748b;margin-top:8px}
    #nr-voice-dictator.nrvd-min{width:160px} #nr-voice-dictator.nrvd-min>*:not(.nrvd-head){display:none}
  `;
  document.documentElement.append(style, panel);

  function status(msg) { const el = $("nrvd-status"); if (el) el.textContent = msg; }
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
  }
  function fieldScore(el) {
    if (!visible(el) || el.closest("#nr-voice-dictator")) return -999;
    const r = el.getBoundingClientRect();
    if (r.width < 180 || r.height < 24) return -30;
    const meta = [
      el.getAttribute("placeholder"), el.getAttribute("aria-label"), el.getAttribute("data-placeholder"),
      el.getAttribute("title"), el.getAttribute("name"), el.id, el.className,
      el.parentElement?.innerText?.slice(0,180), el.parentElement?.getAttribute("aria-label")
    ].join(" ").toLowerCase();
    let score = 0;
    if (/type or paste text|enter text|paste text|text to speech|your text|document text|editor/.test(meta)) score += 12;
    if (/search|email|password|comment|chat|url|website/.test(meta)) score -= 12;
    if (el.matches("textarea")) score += 5;
    if (el.isContentEditable || el.getAttribute("role") === "textbox") score += 4;
    if (r.width > 350 && r.height > 60) score += 3;
    if (el.closest("form")) score -= 2;
    return score;
  }
  function findField() {
    const all = [...document.querySelectorAll('textarea,input:not([type]),input[type="text"],[contenteditable="true"],[role="textbox"]')];
    all.sort((a,b) => fieldScore(b)-fieldScore(a));
    return all[0] && fieldScore(all[0]) > 0 ? all[0] : null;
  }
  function writeField(el, value) {
    el.focus();
    if (el.isContentEditable || el.getAttribute("role") === "textbox" && !("value" in el)) {
      el.textContent = value;
    } else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value); else el.value = value;
    }
    el.dispatchEvent(new InputEvent("input", {bubbles:true, inputType:"insertText", data:value}));
    el.dispatchEvent(new Event("change", {bubbles:true}));
  }
  function pauseResumeButton(field) {
    const exact = document.querySelector('#Play-btn[data-ws-onclick="togglePlay"]') ||
                  document.querySelector("#Play-btn");
    if (exact && visible(exact) && !exact.closest("#nr-voice-dictator") && !exact.disabled) return exact;
    const fallback = [...document.querySelectorAll('button,[role="button"]')].find(el => {
      if (!visible(el) || el.disabled || el.closest("#nr-voice-dictator")) return false;
      const label=[el.getAttribute("aria-label"),el.getAttribute("title"),el.id,el.getAttribute("data-ws-onclick")].join(" ").toLowerCase();
      return /play-btn|play\s*\/\s*pause|toggleplay/.test(label);
    });
    return fallback || null;
  }

  function activateButton(button) {
    if (!button) return false;
    button.scrollIntoView({ block: "nearest", inline: "nearest" });
    button.focus({ preventScroll: true });
    button.click();
    return true;
  }
  function insertTranscript(text) {
    const field = findField();
    if (!field) { status("Dictation heard, but I couldn't find TTSReader's text editor. Open a document in the player first."); return null; }
    writeField(field, text);
    return field;
  }
  function fieldText(el) {
    if (!el) return "";
    return el.isContentEditable ? (el.innerText || el.textContent || "") : (el.value || "");
  }

  function watchPlaybackCompletion(field, expectedText, resumeMic = false) {
    // TTSReader's Play/Pause label stays constant; its state wrappers change visibility.
    let started = false;
    let finished = false;
    let checks = 0;
    const reallyVisible = (el) => {
      if (!el || !el.isConnected) return false;
      for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || node.hidden) return false;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const readState = () => {
      const playingOn = [...document.querySelectorAll('[data-ws-show-if-state="isPlayingOn=true"]')].some(reallyVisible);
      const playingOff = [...document.querySelectorAll('[data-ws-show-if-state="isPlayingOn=false"]')].some(reallyVisible);
      const playButton = document.querySelector("#Play-btn");
      const label = [
        playButton?.getAttribute("aria-label"),
        playButton?.getAttribute("title"),
        playButton?.innerText
      ].join(" ").toLowerCase();
      return {
        playing: playingOn || /pause|stop reading/.test(label),
        ready: playingOff || /play|resume|start reading/.test(label)
      };
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      state.playbackPending = false;
      observer.disconnect();
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);

      // Resume listening after every playback, regardless of the auto-clear setting.
      if (resumeMic) {
        state.suppressRestart = false;
        state.finalText = "";
        state.lastSent = "";
      }
      if (state.clearAfterPlayback && field.isConnected && fieldText(field).trim() === expectedText.trim()) {
        writeField(field, "");
        status("Playback finished; text cleared. Listening for the next phrase…");
      } else {
        status("Playback finished. Listening for the next phrase…");
      }
      if (resumeMic && !state.userStopped) setTimeout(() => start(), 450);
    };
    const check = () => {
      checks++;
      const p = readState();
      if (p.playing) started = true;
      // TTSReader may expose a very brief state change; require that playback was observed first.
      if (started && p.ready) finish();
      // If the player didn't expose a state transition at all, don't endlessly block dictation.
      if (checks > 80 && !started) {
        observer.disconnect();
        clearInterval(pollTimer);
        clearTimeout(timeoutTimer);
        state.playbackPending = false;
        state.suppressRestart = false;
        status("Couldn't detect TTSReader playback state. Mic listening will resume; text was left in place.");
        if (resumeMic && !state.userStopped) setTimeout(() => start(), 450);
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["aria-label", "title", "class", "aria-pressed", "style", "hidden"]
    });
    const pollTimer = setInterval(check, 250);
    const timeoutTimer = setTimeout(() => {
      observer.disconnect();
      clearInterval(pollTimer);
      if (!finished) {
        state.playbackPending = false;
        state.suppressRestart = false;
        status("Playback completion wasn't detected. Text was left in place; restarting dictation.");
        if (resumeMic && !state.userStopped) setTimeout(() => start(), 450);
      }
    }, 15 * 60 * 1000);
  }

  function schedulePlay() {
    clearTimeout(state.timer);
    if (!state.autoPlay || !state.finalText.trim() || state.playbackPending || state.suppressRestart) return;
    state.timer = setTimeout(() => {
      const field = findField();
      if (!field) { status("Text entered, but the text editor wasn't found for Play."); return; }
      const spokenText = fieldText(field).trim();
      if (!spokenText) return;
      const button = pauseResumeButton(field);
      if (!button) { status("TTSReader Play/Pause button wasn't found."); return; }
      state.playbackPending = true;
      state.suppressRestart = true;
      if (state.recognition && state.listening) state.recognition.stop();

      // If the previous sentence is still playing, toggle once to Pause it,
      // then toggle again to Play the newly inserted sentence.
      const playing = [...document.querySelectorAll('[data-ws-show-if-state="isPlayingOn=true"]')].some(el => {
        if (!visible(el)) return false;
        for (let n=el;n&&n!==document.documentElement;n=n.parentElement) {
          const s=getComputedStyle(n);
          if (s.display==="none"||s.visibility==="hidden"||n.hidden) return false;
        }
        return true;
      });
      if (playing) {
        activateButton(button);
        setTimeout(() => {
          const freshButton = pauseResumeButton(field);
          if (freshButton) activateButton(freshButton);
          status("Restarted playback for the new sentence.");
          watchPlaybackCompletion(field, spokenText, true);
        }, 180);
      } else {
        activateButton(button);
        status("Started playback for the new sentence.");
        watchPlaybackCompletion(field, spokenText, true);
      }
    }, 6000);
  }
  function start(options = {}) {
    if (!SpeechRecognition) { status("Speech recognition isn't available here. Try the current version of Chrome on TTSReader Player."); return; }
    if (state.listening || state.suppressRestart) return;
    state.userStopped = false;
    const field = findField();
    if (!field) { status("Open a TTSReader document/editor first, then try again."); return; }
    state.clearOnStart = $("nrvd-clear").checked;
    state.autoPlay = $("nrvd-play").checked;
    if (!options.keepSession) {
      state.finalText = "";
      state.lastSent = "";
      if (state.clearOnStart) writeField(field, "");
    }
    state.sessionBase = options.keepSession ? state.finalText : "";
    const rec = new SpeechRecognition();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    state.recognition = rec;
    rec.onstart = () => {
      state.listening = true;
      $("nrvd-start").disabled = true;
      $("nrvd-stop").disabled = false;
      status(options.keepSession ? "Recognition restarted. Keep speaking…" : "Listening… speak naturally.");
    };
    rec.onresult = (event) => {
      if (state.suppressRestart || state.playbackPending) return;
      // Build one complete transcript snapshot from all results Chrome currently exposes.
      // Only finalized text is committed for playback; interim text is displayed as a preview.
      const finalParts = [];
      const interimParts = [];
      for (let i = 0; i < event.results.length; i++) {
        const phrase = (event.results[i][0]?.transcript || "").trim();
        if (!phrase) continue;
        if (event.results[i].isFinal) finalParts.push(phrase);
        else interimParts.push(phrase);
      }
      const sessionFinal = finalParts.join(" ").replace(/\s+/g, " ").trim();
      const committed = [state.sessionBase, sessionFinal].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      const interim = interimParts.join(" ").replace(/\s+/g, " ").trim();
      const full = [committed, interim].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
      if (full) {
        insertTranscript(full);
        status("Capturing sentence: " + full.slice(-110));
        // Do not play while Chrome is still revising an interim hypothesis.
        // Auto-play is scheduled only after finalized speech has arrived.
        if (committed) {
          state.finalText = committed;
          schedulePlay();
        }
        state.lastSent = full;
      }
    };
    rec.onerror = (event) => {
      const err = event.error || "error";
      status("Speech recognition: " + err + ". " +
        (err === "not-allowed" || err === "service-not-allowed" ? "Check microphone permission." : "Will retry if recognition ended unexpectedly."));
    };
    rec.onend = () => {
      state.listening = false;
      if (state.suppressRestart) {
        $("nrvd-start").disabled = false;
        $("nrvd-stop").disabled = true;
        return;
      }
      if (state.userStopped) {
        state.userStopped = false;
        $("nrvd-start").disabled = false;
        $("nrvd-stop").disabled = true;
        if (state.finalText.trim()) schedulePlay();
        else status("Stopped. No speech was captured.");
        return;
      }
      // Chrome can end a continuous recognition session after a silence or timeout.
      // Restart it automatically unless playback is in progress or the user stopped.
      // Chrome may end a continuous recognition session mid-sentence. Do not interpret
      // onend as a speech pause and do not trigger playback here; restart listening instead.
      clearTimeout(state.timer);
      status("Recognition session ended; reconnecting microphone without playing partial text…");
      clearTimeout(state.restartTimer);
      state.restartTimer = setTimeout(() => start({ keepSession: true }), 250);
    };
    try { rec.start(); }
    catch (e) {
      state.listening = false;
      status("Couldn't start microphone: " + e.message + ". Retrying…");
      clearTimeout(state.restartTimer);
      state.restartTimer = setTimeout(() => start({ keepSession: true }), 1200);
    }
  }
  function stop() {
    state.userStopped = true;
    clearTimeout(state.timer);
    clearTimeout(state.restartTimer);
    if (state.recognition && state.listening) state.recognition.stop();
    state.listening = false;
    state.suppressRestart = false;
    $("nrvd-start").disabled = false;
    $("nrvd-stop").disabled = true;
    status("Dictation stopped.");
  }


  $("nrvd-start").addEventListener("click", start);
  $("nrvd-stop").addEventListener("click", stop);
  $("nrvd-play").addEventListener("change", e => state.autoPlay = e.target.checked);
  $("nrvd-clear-after").addEventListener("change", e => state.clearAfterPlayback = e.target.checked);
  $("nrvd-hide").addEventListener("click", () => panel.classList.toggle("nrvd-min"));
  const observer = new MutationObserver(() => {
    if (!panel.isConnected && document.documentElement) document.documentElement.append(panel);
  });
  observer.observe(document.documentElement, {childList:true,subtree:true});
})();