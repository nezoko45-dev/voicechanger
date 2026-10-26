(() => {
  if (window.__naturalReaderDictatorLoaded) return;
  window.__naturalReaderDictatorLoaded = true;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const state = { recognition: null, listening: false, finalText: "", timer: null, lastSent: "", autoPlay: true, clearOnStart: true };
  const $ = (id) => document.getElementById(id);

  const panel = document.createElement("section");
  panel.id = "nr-voice-dictator";
  panel.innerHTML = `
    <div class="nrvd-head"><strong>Voice Dictator</strong><button id="nrvd-hide" title="Hide panel">−</button></div>
    <div class="nrvd-row"><button id="nrvd-start">🎙 Start dictation</button><button id="nrvd-stop" disabled>Stop</button></div>
    <label><input id="nrvd-clear" type="checkbox" checked> Clear text field when starting</label>
    <label><input id="nrvd-play" type="checkbox" checked> Auto-press Play after a pause</label>
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
    // Find the actual blue circular control in NaturalReader's top playback bar.
    // Some versions use a custom div rather than a native <button>.
    const nodes = [...document.querySelectorAll('button,[role="button"],[tabindex], [onclick], body *')]
      .filter(visible)
      .filter(el => !el.closest("#nr-voice-dictator"));
    let best = null, bestScore = -999;
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24 || r.width > 100 || r.height > 100 || r.top > 125) continue;
      const ratio = r.width / r.height;
      if (ratio < 0.72 || ratio > 1.35) continue;

      const bg = getComputedStyle(el).backgroundColor;
      const m = bg.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      const isBlue = !!(m && +m[3] > 100 && +m[3] > +m[1] * 1.15 && +m[3] > +m[2] * 1.05);
      const label = [
        el.innerText, el.getAttribute("aria-label"), el.getAttribute("title"),
        el.getAttribute("data-testid")
      ].join(" ").toLowerCase().replace(/\s+/g, " ").trim();
      if (/settings|voice|speed|download|upload|login|sign in|menu|close|clear|volume|undo|redo/.test(label)) continue;

      let score = isBlue ? 30 : 0;
      if (/\bplay\b|resume|start reading/.test(label)) score += 20;
      if (/\bpause\b/.test(label)) score += 4;
      if (r.top < 75) score += 5;
      // The screenshot's play control is between Undo and Redo, around the
      // central part of the top toolbar, not the leftmost avatar button.
      if (r.left > 90 && r.left < Math.min(window.innerWidth - 80, 360)) score += 5;
      const svg = el.querySelector("svg");
      if (svg && !label) score += 2;

      if (isBlue && score > bestScore) { best = el; bestScore = score; }
    }
    if (!best) return null;

    // If the blue circle is an icon inside a clickable parent, click the
    // nearest button-like ancestor, not just the decorative icon.
    let clickable = best;
    for (let p = best; p && p !== document.body; p = p.parentElement) {
      if (p.matches('button,[role="button"],[tabindex],[onclick]')) {
        clickable = p;
        break;
      }
      if (p !== best && p.getBoundingClientRect().width > 180) break;
    }
    return clickable;
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
    if (!field) { status("Dictation heard, but I couldn't find NaturalReader's text field. Open Add Text / Type or Paste Text."); return null; }
    writeField(field, text);
    return field;
  }
  function schedulePlay() {
    clearTimeout(state.timer);
    if (!state.autoPlay || !state.finalText.trim()) return;
    state.timer = setTimeout(() => {
      const field = findField();
      if (!field) { status("Text entered, but the text field wasn't found for Play."); return; }
      const button = pauseResumeButton(field);
      if (!button) { status("Text entered, but I couldn't confidently find the blue playback button. Click it manually; please keep the editor and button visible."); return; }
      activateButton(button);
      status("Click event sent to the blue toolbar control. Check whether playback actually starts.");
    }, 1400);
  }
  function start() {
    if (!SpeechRecognition) { status("Speech recognition isn't available here. Try current Chrome on NaturalReader's Online Reader."); return; }
    if (state.listening) return;
    const field = findField();
    if (!field) { status("Open NaturalReader's Type or Paste Text editor first, then try again."); return; }
    state.clearOnStart = $("nrvd-clear").checked;
    state.autoPlay = $("nrvd-play").checked;
    state.finalText = "";
    state.lastSent = "";
    if (state.clearOnStart) writeField(field, "");
    const rec = new SpeechRecognition();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => { state.listening = true; $("nrvd-start").disabled = true; $("nrvd-stop").disabled = false; status("Listening… speak naturally."); };
    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const phrase = event.results[i][0].transcript;
        if (event.results[i].isFinal) state.finalText += phrase;
        else interim += phrase;
      }
      const full = (state.finalText + interim).trim();
      if (full) {
        const target = insertTranscript(full);
        status("Hearing: " + full.slice(-110));
        if (state.finalText.trim()) schedulePlay();
        if (target) state.lastSent = full;
      }
    };
    rec.onerror = (event) => status("Speech recognition: " + (event.error || "error") + ". Check microphone permission.");
    rec.onend = () => {
      state.listening = false;
      $("nrvd-start").disabled = false;
      $("nrvd-stop").disabled = true;
      if (state.finalText.trim()) schedulePlay();
      if (!state.finalText.trim()) status("Stopped. No speech was captured.");
    };
    state.recognition = rec;
    try { rec.start(); } catch (e) { status("Couldn't start microphone: " + e.message); }
  }
  function stop() {
    clearTimeout(state.timer);
    if (state.recognition && state.listening) state.recognition.stop();
    state.listening = false;
    $("nrvd-start").disabled = false;
    $("nrvd-stop").disabled = true;
    status("Dictation stopped.");
  }

  $("nrvd-start").addEventListener("click", start);
  $("nrvd-stop").addEventListener("click", stop);
  $("nrvd-play").addEventListener("change", e => state.autoPlay = e.target.checked);
  $("nrvd-hide").addEventListener("click", () => panel.classList.toggle("nrvd-min"));
  const observer = new MutationObserver(() => {
    if (!panel.isConnected && document.documentElement) document.documentElement.append(panel);
  });
  observer.observe(document.documentElement, {childList:true,subtree:true});
})();