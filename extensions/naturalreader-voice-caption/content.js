(() => {
  if (window.__naturalReaderAutoVoiceInstalled) return;
  window.__naturalReaderAutoVoiceInstalled = true;

  const state = { enabled: true, silenceMs: 2200, timer: null, lastText: "", running: false, recognition: null, dictating: false, baseline: null, pendingText: "", originalText: "" };
  const clean = s => String(s || "").replace(/\s+/g, " ").trim();
  const visible = el => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  };
  const textOf = el => clean(("value" in el ? el.value : el.innerText || el.textContent) || "");
  const labelOf = el => clean([el.innerText, el.textContent, el.getAttribute("aria-label"), el.getAttribute("title"), el.getAttribute("data-testid"), el.getAttribute("data-tooltip"), el.getAttribute("aria-labelledby")].join(" ")).toLowerCase();
  function setStatus(s) { const el = document.querySelector("#nrv-status"); if (el) el.textContent = s; }
  function editors() {
    return [...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"],input:not([type="hidden"]):not([type="range"]):not([type="checkbox"])')]
      .filter(el => visible(el) && !el.closest("#nrv-panel"));
  }
  function score(el) {
    const hint = [el.getAttribute("placeholder"),el.getAttribute("aria-label"),el.getAttribute("data-placeholder"),el.getAttribute("data-testid"),typeof el.className === "string" ? el.className : ""].join(" ").toLowerCase();
    return (el.matches('textarea,[contenteditable="true"],[role="textbox"]') ? 4 : 0) + (/text|editor|document|content|type|write|paste/i.test(hint) ? 5 : 0) + (el.getBoundingClientRect().width > 350 ? 1 : 0);
  }
  function getEditor() { return editors().sort((a,b) => score(b)-score(a))[0] || null; }
  function buttons() {
    const found = new Set(document.querySelectorAll('button,[role="button"],[data-testid*="play" i],[aria-label*="play" i],[title*="play" i]'));
    // Include clickable wrappers around unlabeled SVG icons, but only DOM elements.
    document.querySelectorAll("svg").forEach(svg => {
      let el = svg;
      for (let i = 0; i < 3 && el && el !== document.body; i++, el = el.parentElement) {
        if (el instanceof Element && (el.matches("button,[role=button]") || getComputedStyle(el).cursor === "pointer")) found.add(el);
      }
    });
    return [...found].filter(el => el instanceof Element && visible(el) && !el.closest("#nrv-panel"));
  }
  function clickPlay() {
    const editor = getEditor();
    const er = editor?.getBoundingClientRect();
    const candidates = buttons().map(el => {
      const label = labelOf(el), box = el.getBoundingClientRect();
      const svg = el.querySelector("svg");
      const paths = [...(svg?.querySelectorAll("path") || [])].map(p => p.getAttribute("d") || "");
      const svgInfo = svg ? [svg.getAttribute("class"), svg.innerHTML].join(" ").toLowerCase() : "";
      const triangle = /play|triangle/.test(svgInfo) || paths.some(d => /z\s*$/i.test(d) && /M[\s\S]*L[\s\S]*L/.test(d));
      const isPlayLabel = /play|listen|start reading|read aloud|resume reading/.test(label) && !/replay|playlist|display|playback speed|play store|template/.test(label);
      const aboveEditor = !!er && box.bottom <= er.top + 80;
      const toolbar = !!el.closest('header,[role="toolbar"],[class*="toolbar" i],[class*="header" i]');
      const score = (isPlayLabel ? 100 : 0) + (triangle ? 45 : 0) + (aboveEditor ? 35 : 0) + (toolbar ? 25 : 0) + (box.top < 180 ? 8 : 0);
      return {el,label,box,score,isPlayLabel,aboveEditor,triangle};
    }).filter(x => x.score > 0 && (x.isPlayLabel || (x.aboveEditor && x.triangle)));
    candidates.sort((a,b) => b.score-a.score);
    const candidate = candidates[0];
    if (!candidate || !(candidate.el instanceof Element)) {
      setStatus("Couldn't locate the blue top Play button above the TTS field. Text was kept.");
      return false;
    }
    const target = candidate.el.closest("button,[role=button]") || candidate.el;
    if (typeof target.click !== "function") {
      setStatus("Found a possible Play icon, but it isn't clickable. Text was kept.");
      return false;
    }
    target.click();
    return true;
  }
  function setEditorText(editor, text) {
    if (!editor) return false;
    editor.focus();
    if (editor.isContentEditable || editor.getAttribute("contenteditable") === "true" || editor.getAttribute("role") === "textbox") {
      editor.textContent = text;
      editor.dispatchEvent(new InputEvent("input", {bubbles:true, inputType:"insertText", data:text}));
    } else {
      const proto = editor.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(editor, text); else editor.value = text;
      editor.dispatchEvent(new Event("input", {bubbles:true}));
      editor.dispatchEvent(new Event("change", {bubbles:true}));
    }
    return true;
  }
  function clearEditor() {
    const candidates = buttons().map(el => ({el,label:labelOf(el)}));
    const clear = candidates.find(x => /clear text|clear document|delete text|remove text|clear all/.test(x.label)) ||
      candidates.find(x => /^(clear|tx|delete)$/i.test(x.label));
    if (clear) { clear.el.click(); return true; }
    return setEditorText(getEditor(), "");
  }
  function estimatePlaybackMs(text) {
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(4500, Math.min(180000, words / 2.3 * 1000 + 3000));
  }
  function waitForPlayback(text, editor, originalText) {
    const started = Date.now(), maxWait = estimatePlaybackMs(text);
    let sawPlaying = false;
    const timer = setInterval(() => {
      const audio = [...document.querySelectorAll("audio,video")];
      const active = audio.some(a => !a.paused && !a.ended);
      if (active) sawPlaying = true;
      if ((sawPlaying && audio.length && audio.every(a => a.paused || a.ended)) || Date.now()-started > maxWait) {
        clearInterval(timer);
        // Restore the existing story instead of deleting or re-pasting it as new speech.
        if (editor && editor.isConnected) setEditorText(editor, originalText);
        state.baseline = originalText;
        state.lastText = "";
        state.running = false;
        setStatus("Finished playing only the new text. Previous text was preserved; ready for the next addition.");
      }
    }, 500);
  }
  function newDelta(previous, current) {
    previous = clean(previous); current = clean(current);
    if (!previous) return current;
    if (current === previous) return "";
    if (current.startsWith(previous)) return clean(current.slice(previous.length));
    // For edits in the middle, isolate the changed section rather than replaying the whole field.
    let prefix = 0;
    while (prefix < previous.length && prefix < current.length && previous[prefix] === current[prefix]) prefix++;
    let suffix = 0;
    while (suffix < previous.length-prefix && suffix < current.length-prefix &&
      previous[previous.length-1-suffix] === current[current.length-1-suffix]) suffix++;
    return clean(current.slice(prefix, current.length-suffix));
  }
  function processText(delta, expectedText) {
    delta = clean(delta);
    if (!state.enabled || state.running || delta.length < 2) return;
    state.running = true;
    state.pendingText = delta;
    setStatus("New text detected. Preparing just that addition for playback…");
    setTimeout(() => {
      if (!state.enabled) { state.running = false; return; }
      const editor = getEditor();
      const current = editor ? textOf(editor) : "";
      if (!editor || current !== expectedText) {
        state.running = false;
        setStatus("Text changed during the pause; waiting for the latest addition.");
        return;
      }
      state.originalText = current;
      // NaturalReader reads its editor contents, so temporarily put only the new words there.
      if (!setEditorText(editor, delta)) {
        state.running = false;
        setStatus("Couldn't prepare the new text. Your original text was kept.");
        return;
      }
      if (!clickPlay()) {
        setEditorText(editor, current);
        state.running = false;
        setStatus("Couldn't find Play. Original text restored and kept safe.");
        return;
      }
      state.baseline = current;
      setStatus("Playing only the new text; the existing story will be restored afterward.");
      waitForPlayback(delta, editor, current);
    }, 250);
  }
  function queueText(_ignoredDelta, current) {
    current = clean(current);
    if (!current || state.running) return;
    const baseline = state.baseline === null ? "" : state.baseline;
    const delta = newDelta(baseline, current);
    if (!delta) return;
    clearTimeout(state.timer);
    state.pendingText = delta;
    setStatus("Listening for a pause in your microphone…");
    state.timer = setTimeout(() => {
      const latestEditor = getEditor();
      const latest = latestEditor ? textOf(latestEditor) : "";
      if (latest && latest === current) processText(newDelta(baseline, latest), latest);
    }, state.silenceMs);
  }
  function onEditorChange(e) {
    const el = e.target;
    if (!el || el.closest?.("#nrv-panel") || !el.matches?.('textarea,[contenteditable="true"],[role="textbox"],input')) return;
    const current = textOf(el);
    if (!current) return;
    if (state.baseline === null) { state.baseline = current; return; }
    const delta = newDelta(state.baseline, current);
    if (delta) queueText(delta, current);
  }
  function startDictation() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setStatus("Chrome dictation isn't available here. Use Windows voice typing (Win+H) in the NaturalReader text box."); return; }
    if (state.dictating && state.recognition) { state.recognition.stop(); return; }
    const editor = getEditor();
    if (!editor) { setStatus("Open NaturalReader's Add Text editor first, then tap Dictate."); return; }
    const recognition = new SR();
    state.recognition = recognition;
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    let finalText = "";
    state.dictating = true;
    const btn = document.querySelector("#nrv-dictate");
    if (btn) btn.textContent = "Stop dictation";
    setStatus("Listening… speak now. Dictation uses Chrome's speech recognition.");
    recognition.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = clean(event.results[i][0].transcript);
        if (event.results[i].isFinal) finalText = clean(finalText + " " + transcript);
        else interim += " " + transcript;
      }
      const dictated = clean(finalText + " " + interim);
      // Dictation appends only this session's new words; it never seeds itself with the old story.
      const prior = state.baseline === null ? textOf(editor) : state.baseline;
      setEditorText(editor, clean(prior + " " + dictated));
      if (dictated) {
        // Restart the silence countdown on every recognition update, including interim mic speech.
        clearTimeout(state.timer);
        queueText("", textOf(editor));
      }
    };
    recognition.onerror = event => setStatus("Dictation issue: " + event.error + ". You can type instead.");
    recognition.onend = () => {
      state.dictating = false;
      if (btn) btn.textContent = "🎙 Dictate";
      const current = getEditor();
      if (current && textOf(current) && finalText) queueText("", textOf(current));
      setStatus("Dictation stopped. Waiting for microphone silence before playback…");
    };
    recognition.start();
  }
  function buildPanel() {
    if (document.querySelector("#nrv-panel")) return;
    const p = document.createElement("section");
    p.id = "nrv-panel";
    Object.assign(p.style,{position:"fixed",right:"14px",bottom:"14px",zIndex:"2147483647",width:"280px",boxSizing:"border-box",padding:"12px",borderRadius:"12px",background:"#171827",color:"#fff",font:"13px system-ui,sans-serif",boxShadow:"0 8px 30px #0008"});
    p.innerHTML = '<div style="font-weight:750;font-size:14px;margin-bottom:8px">NaturalReader Voice Automation</div><label style="display:flex;align-items:center;gap:7px"><input id="nrv-enabled" type="checkbox" checked> Automation ON</label><label style="display:block;margin-top:8px">Mic silence before auto-play <span id="nrv-ms-label">2.2 sec</span><input id="nrv-silence" type="range" min="800" max="5000" step="200" value="2200" style="width:100%"></label><div style="display:flex;gap:6px;margin-top:8px"><button id="nrv-dictate" type="button">🎙 Start mic</button></div><div style="font-size:12px;color:#cbd5e1;margin-top:8px;line-height:1.4">When automation is ON, speech is detected, then NaturalReader automatically plays only the new words after microphone silence. No Play now button needed.</div><div id="nrv-status" role="status" style="margin-top:8px;color:#cbd5e1;line-height:1.35">Automation is ON. Start the microphone to begin.</div>';
    document.documentElement.appendChild(p);
    p.querySelectorAll("button").forEach(b => Object.assign(b.style,{width:"50%",border:"0",borderRadius:"7px",padding:"8px 5px",background:"#4f46e5",color:"white",fontWeight:"650",cursor:"pointer"}));
    p.querySelector("#nrv-enabled").onchange = e => {
      state.enabled = e.target.checked;
      clearTimeout(state.timer);
      if (!state.enabled) {
        if (state.recognition && state.dictating) state.recognition.stop();
        setStatus("Automation OFF. Microphone auto-play is paused.");
      } else {
        setStatus("Automation ON. Start the microphone to automatically play new speech after silence.");
        if (!state.dictating) startDictation();
      }
    };
    p.querySelector("#nrv-silence").oninput = e => { state.silenceMs = Number(e.target.value); p.querySelector("#nrv-ms-label").textContent = (state.silenceMs/1000).toFixed(1)+" sec"; };
    p.querySelector("#nrv-dictate").onclick = startDictation;
    p.addEventListener("mousedown",e=>e.stopPropagation());
  }
  document.addEventListener("input", onEditorChange, true);
  document.addEventListener("change", onEditorChange, true);
  function init() {
    buildPanel();
    setStatus("Automation ON. Start the microphone to automatically play new speech after silence.");
    setInterval(() => {
      if (!state.enabled || state.running) return;
      const e = getEditor(), text = e ? textOf(e) : "";
      if (!text) return;
      if (state.baseline === null) { state.baseline = text; return; }
      const delta = newDelta(state.baseline, text);
      if (delta) queueText(delta, text);
    }, 700);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, {once:true}); else init();
})();