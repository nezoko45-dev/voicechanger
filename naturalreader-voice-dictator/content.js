(() => {
  if (window.__naturalReaderDictatorLoaded) return;
  window.__naturalReaderDictatorLoaded = true;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const state = { recognition: null, listening: false, suppressRestart: false, userStopped: false, restartTimer: null, finalText: "", timer: null, lastSent: "", autoPlay: true, clearOnStart: true, clearAfterPlayback: true };
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
    // Prefer explicit accessible playback controls on TTSReader and TTSReader.
    const candidates = [...document.querySelectorAll(
      'button,[role="button"],[aria-label],[title],svg[aria-label]'
    )].filter(el => visible(el) && !el.closest("#nr-voice-dictator"));
    const score = (el) => {
      const meta = [
        el.getAttribute("aria-label"), el.getAttribute("title"),
        el.getAttribute("data-testid"), el.innerText, el.textContent
      ].join(" ").trim().toLowerCase();
      let n = 0;
      if (/play|resume|start reading|listen/.test(meta)) n += 10;
      if (/pause|stop|next|previous|skip|export|download|generate mp3/.test(meta)) n -= 8;
      if (el.matches("svg")) n -= 2;
      if (el.matches("button,[role='button']")) n += 4;
      const r = el.getBoundingClientRect();
      if (r.width > 160 || r.height > 100) n -= 5;
      if (field && el.contains(field)) n -= 20;
      return n;
    };
    candidates.sort((a,b) => score(b)-score(a));
    const best = candidates[0];
    if (!best || score(best) < 8) return null;
    if (best.matches("svg")) {
      return best.closest('button,[role="button"],[tabindex],[onclick]') || best;
    }
    return best;
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
    if (!state.clearAfterPlayback) return;
    let started = false;
    let finished = false;
    const playState = () => {
      const controls = [...document.querySelectorAll('button,[role="button"],[aria-label],[title]')]
        .filter(el => visible(el) && !el.closest("#nr-voice-dictator"));
      const labels = controls.map(el => [
        el.getAttribute("aria-label"), el.getAttribute("title"), el.innerText
      ].join(" ").toLowerCase()).join(" ");
      return { playing: /pause|stop reading/.test(labels), ready: /play|resume|start reading/.test(labels) };
    };
    const observer = new MutationObserver(() => {
      const p = playState();
      if (p.playing) started = true;
      else if (started && p.ready) finished = true;
      if (!finished) return;
      observer.disconnect();
      if (resumeMic) {
        state.suppressRestart = false;
        state.finalText = "";
        state.lastSent = "";
        start();
      }
      if (field.isConnected && fieldText(field).trim() === expectedText.trim()) {
        writeField(field, "");
        status("Playback finished; text field cleared.");
      } else status("Playback finished; left the field unchanged because its text had changed.");
    });
    observer.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["aria-label", "title", "class", "aria-pressed"]
    });
    setTimeout(() => {
      observer.disconnect();
      if (!finished) status("Couldn't confirm playback completion from the page controls; text was left in place.");
    }, 15 * 60 * 1000);
  }

  function schedulePlay() {
    clearTimeout(state.timer);
    if (!state.autoPlay || !state.finalText.trim()) return;
    state.timer = setTimeout(() => {
      const field = findField();
      if (!field) { status("Text entered, but the text editor wasn't found for Play."); return; }
      const button = pauseResumeButton(field);
      if (!button) { status("Text entered, but I couldn't confidently identify TTSReader's Play control. Please click Play manually and share its button label from DevTools so I can target it exactly."); return; }
      const spokenText = fieldText(field).trim();
      state.suppressRestart = true;
      if (state.recognition && state.listening) state.recognition.stop();
      activateButton(button);
      status("Play clicked. Mic dictation is paused while TTSReader speaks.");
      watchPlaybackCompletion(field, spokenText, true);
    }, 1400);
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
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const phrase = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          const clean = phrase.trim();
          if (clean) state.finalText += (state.finalText && !/\s$/.test(state.finalText) ? " " : "") + clean;
        } else interim += phrase;
      }
      const full = (state.finalText + (interim ? " " + interim : "")).trim();
      if (full) {
        const target = insertTranscript(full);
        status("Hearing: " + full.slice(-110));
        if (state.finalText.trim()) schedulePlay();
        if (target) state.lastSent = full;
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
      status("Recognition ended; restarting microphone listening…");
      clearTimeout(state.restartTimer);
      state.restartTimer = setTimeout(() => start({ keepSession: true }), 500);
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