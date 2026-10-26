(() => {
  if (window.__naturalReaderAutoVoiceInstalled) return;
  window.__naturalReaderAutoVoiceInstalled = true;

  const state = { enabled: true, silenceMs: 2200, timer: null, lastText: "", running: false, recognition: null, dictating: false };
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
    // NaturalReader's top toolbar may render the icon inside an unlabelled clickable wrapper.
    document.querySelectorAll("svg").forEach(svg => {
      let el = svg;
      for (let i = 0; i < 3 && el && el !== document.body; i++, el = el.parentElement) {
        if (el.matches?.("button,[role=button]") || getComputedStyle(el).cursor === "pointer") found.add(el);
      }
    });
    return [...found].filter(el => visible(el) && !el.closest("#nrv-panel"));
  }
  function clickPlay() {
    const editor = getEditor();
    const er = editor?.getBoundingClientRect();
    const candidates = buttons().map(el => {
      const label = labelOf(el), box = el.getBoundingClientRect();
      const svg = el.querySelector("svg");
      const paths = [...(svg?.querySelectorAll("path") || [])].map(p => p.getAttribute("d") || "");
      const svgInfo = svg ? [svg.getAttribute("class"), svg.innerHTML].join(" ").toLowerCase() : "";
      const triangle = /play|triangle/.test(svgInfo) || paths.some(d => /^M[^ ]*[\\s\\S]*(?:v|V)[^ ]*[\\s\\S]*(?:l|L)[^ ]*z$/i.test(d) || /M\s*\d[\s\S]*L\s*\d[\s\S]*L\s*\d[\s\S]*z/i.test(d));
      const isPlayLabel = /play|listen|start reading|read aloud|resume reading/.test(label) && !/replay|playlist|display|playback speed|play store|template/.test(label);
      const style = getComputedStyle(el);
      const blueCircle = /rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/.test(style.backgroundColor) &&
        (style.borderRadius.includes("%") || parseFloat(style.borderRadius) >= Math.min(box.width,box.height)*0.35) &&
        box.width >= 28 && box.width <= 70 && box.height >= 28 && box.height <= 70;
      // Target the screenshot's blue circular Play control in the toolbar above the TTS field.
      const aboveEditor = !!er && box.bottom <= er.top + 80;
      const toolbar = !!el.closest('header,[role="toolbar"],[class*="toolbar" i],[class*="header" i]');
      const score = (isPlayLabel ? 100 : 0) + (triangle ? 45 : 0) + (blueCircle ? 40 : 0) + (aboveEditor ? 35 : 0) + (toolbar ? 25 : 0) + (box.top < 180 ? 8 : 0);
      return {el,label,box,score,isPlayLabel,aboveEditor,triangle,blueCircle};
    }).filter(x => x.score > 0 && (x.isPlayLabel || (x.aboveEditor && x.triangle)));
    candidates.sort((a,b) => b.score-a.score);
    const b = candidates[0];
    if (!b) { setStatus("Couldn't locate the blue top Play button above the TTS field. Text was kept."); return false; }
    b.el.click();
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
  function waitForPlayback(text) {
    const started = Date.now(), maxWait = estimatePlaybackMs(text);
    let sawPlaying = false;
    const timer = setInterval(() => {
      const audio = [...document.querySelectorAll("audio,video")];
      const active = audio.some(a => !a.paused && !a.ended);
      if (active) sawPlaying = true;
      if ((sawPlaying && audio.length && audio.every(a => a.paused || a.ended)) || Date.now()-started > maxWait) {
        clearInterval(timer);
        if (state.enabled) {
          const ok = clearEditor();
          state.lastText = "";
          state.running = false;
          setStatus(ok ? "Playback finished; text cleared. Ready to dictate or type again." : "Playback timer ended; couldn't clear the editor.");
        }
      }
    }, 500);
  }
  function processText(text) {
    text = clean(text);
    if (!state.enabled || state.running || text.length < 2 || text === state.lastText) return;
    state.running = true;
    state.lastText = text;
    setStatus("Text detected. Looking for NaturalReader's Play control…");
    setTimeout(() => {
      if (!state.enabled) { state.running = false; return; }
      const editor = getEditor();
      if (!editor || textOf(editor) !== text) { state.running = false; setStatus("Text changed; waiting for a pause."); return; }
      if (!clickPlay()) { state.running = false; setStatus("Couldn't find Play. Your text is safe—press Play now or click NaturalReader's Play button."); return; }
      setStatus("Play clicked. Text will clear after playback.");
      waitForPlayback(text);
    }, 250);
  }
  function queueText(text) {
    text = clean(text);
    if (!text || state.running) return;
    clearTimeout(state.timer);
    setStatus("Text detected. Waiting for a pause…");
    state.timer = setTimeout(() => processText(text), state.silenceMs);
  }
  function onEditorChange(e) {
    const el = e.target;
    if (!el || el.closest?.("#nrv-panel") || !el.matches?.('textarea,[contenteditable="true"],[role="textbox"],input')) return;
    const text = textOf(el);
    if (text) queueText(text);
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
    let finalText = textOf(editor);
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
      setEditorText(editor, clean(finalText + " " + interim));
      if (interim.trim()) setStatus("Hearing: " + clean(interim));
      if (finalText) queueText(finalText);
    };
    recognition.onerror = event => setStatus("Dictation issue: " + event.error + ". You can type instead.");
    recognition.onend = () => {
      state.dictating = false;
      if (btn) btn.textContent = "🎙 Dictate";
      const current = getEditor();
      if (current && textOf(current)) queueText(textOf(current));
      setStatus("Dictation stopped. Waiting to play the captured text…");
    };
    recognition.start();
  }
  function buildPanel() {
    if (document.querySelector("#nrv-panel")) return;
    const p = document.createElement("section");
    p.id = "nrv-panel";
    Object.assign(p.style,{position:"fixed",right:"14px",bottom:"14px",zIndex:"2147483647",width:"280px",boxSizing:"border-box",padding:"12px",borderRadius:"12px",background:"#171827",color:"#fff",font:"13px system-ui,sans-serif",boxShadow:"0 8px 30px #0008"});
    p.innerHTML = '<div style="font-weight:750;font-size:14px;margin-bottom:8px">NaturalReader Auto + Dictation</div><label style="display:flex;align-items:center;gap:7px"><input id="nrv-enabled" type="checkbox" checked> Auto-play after silence</label><label style="display:block;margin-top:8px">Pause before Play <span id="nrv-ms-label">2.2 sec</span><input id="nrv-silence" type="range" min="800" max="5000" step="200" value="2200" style="width:100%"></label><div style="display:flex;gap:6px;margin-top:8px"><button id="nrv-dictate" type="button">🎙 Dictate</button><button id="nrv-play-now" type="button">▶ Play now</button></div><div style="font-size:12px;color:#cbd5e1;margin-top:8px;line-height:1.4">After playback, the text clears so you can enter the next message.</div><div id="nrv-status" role="status" style="margin-top:8px;color:#cbd5e1;line-height:1.35">Ready. Open Add Text, then type or dictate.</div>';
    document.documentElement.appendChild(p);
    p.querySelectorAll("button").forEach(b => Object.assign(b.style,{width:"50%",border:"0",borderRadius:"7px",padding:"8px 5px",background:"#4f46e5",color:"white",fontWeight:"650",cursor:"pointer"}));
    p.querySelector("#nrv-enabled").onchange = e => { state.enabled = e.target.checked; setStatus(state.enabled ? "Auto-play enabled." : "Auto-play paused."); };
    p.querySelector("#nrv-silence").oninput = e => { state.silenceMs = Number(e.target.value); p.querySelector("#nrv-ms-label").textContent = (state.silenceMs/1000).toFixed(1)+" sec"; };
    p.querySelector("#nrv-dictate").onclick = startDictation;
    p.querySelector("#nrv-play-now").onclick = () => { const e=getEditor(); if (!e || !textOf(e)) { setStatus("Couldn't find text. Open Add Text and enter a sentence first."); return; } if (!clickPlay()) { setStatus("Couldn't locate NaturalReader's Play button. Press its Play button manually."); return; } const text=textOf(e); state.running=true; state.lastText=text; setStatus("Play clicked. Waiting for playback to finish…"); waitForPlayback(text); };
    p.addEventListener("mousedown",e=>e.stopPropagation());
  }
  document.addEventListener("input", onEditorChange, true);
  document.addEventListener("change", onEditorChange, true);
  function init() {
    buildPanel();
    setStatus("Ready. Open Add Text, then type or dictate.");
    setInterval(() => {
      if (!state.enabled || state.running) return;
      const e = getEditor(), text = e ? textOf(e) : "";
      if (text && text !== state.lastText) queueText(text);
    }, 700);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, {once:true}); else init();
})();