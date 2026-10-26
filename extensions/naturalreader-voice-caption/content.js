(() => {
  if (window.__naturalReaderAutoVoiceInstalled) return;
  window.__naturalReaderAutoVoiceInstalled = true;

  const state = { enabled: true, silenceMs: 2200, timer: null, lastText: "", pendingText: "", running: false, cleared: false };
  const clean = s => String(s || "").replace(/\\s+/g, " ").trim();
  const visible = el => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
  };
  const textOf = el => clean(("value" in el ? el.value : el.innerText || el.textContent) || "");
  function setStatus(s) { const el = document.querySelector("#nrv-status"); if (el) el.textContent = s; }
  function editors() {
    return [...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"],input:not([type="hidden"])')]
      .filter(el => visible(el) && !el.closest("#nrv-panel") && !el.matches("#nrv-silence"));
  }
  function getEditor() {
    const list = editors();
    list.sort((a,b) => score(b)-score(a));
    return list[0] || null;
  }
  function score(el) {
    const hint = [el.getAttribute("placeholder"),el.getAttribute("aria-label"),el.getAttribute("data-placeholder"),el.getAttribute("data-testid"),el.className].join(" ").toLowerCase();
    return (el.matches('textarea,[contenteditable="true"],[role="textbox"]') ? 3 : 0) + (/text|editor|document|content|type/i.test(hint) ? 3 : 0);
  }
  function buttons() { return [...document.querySelectorAll('button,[role="button"]')].filter(el => visible(el) && !el.closest("#nrv-panel")); }
  function clickPlay() {
    const candidates = buttons().map(el => ({el, label:[el.innerText,el.getAttribute("aria-label"),el.getAttribute("title"),el.getAttribute("data-testid")].join(" ").toLowerCase()}));
    const b = candidates.find(x => /^(play|listen|start reading|read aloud)(\\b|$)/.test(clean(x.label))) ||
      candidates.find(x => /play|start reading|listen/.test(x.label) && !/replay|playlist|display|playback speed/.test(x.label));
    if (!b) return false;
    b.el.click(); return true;
  }
  function clearEditor() {
    // Prefer NaturalReader's own clear-text control so its app state stays in sync.
    const candidates = buttons().map(el => ({el,label:[el.innerText,el.getAttribute("aria-label"),el.getAttribute("title"),el.getAttribute("data-testid")].join(" ").toLowerCase()}));
    const clear = candidates.find(x => /clear text|clear document|delete text|remove text/.test(x.label)) ||
      candidates.find(x => /^(clear|delete text|clear all|^tx$)$/.test(clean(x.label)));
    if (clear) { clear.el.click(); return true; }
    const editor = getEditor();
    if (!editor) return false;
    if ("value" in editor) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), "value")?.set;
      if (setter) setter.call(editor, ""); else editor.value = "";
      editor.dispatchEvent(new Event("input", {bubbles:true}));
      editor.dispatchEvent(new Event("change", {bubbles:true}));
    } else {
      editor.focus();
      editor.textContent = "";
      editor.dispatchEvent(new InputEvent("input", {bubbles:true,inputType:"deleteContent"}));
    }
    return true;
  }
  function estimatePlaybackMs(text) {
    const words = text.split(/\\s+/).filter(Boolean).length;
    return Math.max(4000, Math.min(180000, words / 2.4 * 1000 + 3500));
  }
  function waitForPlayback(text) {
    const started = Date.now();
    const maxWait = estimatePlaybackMs(text);
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
          setStatus(ok ? "Playback finished; text cleared. Ready for more." : "Playback likely finished, but I couldn't find the clear-text control.");
        }
      }
    }, 700);
  }
  function processText(text) {
    text = clean(text);
    if (!state.enabled || state.running || text.length < 2 || text === state.lastText) return;
    state.running = true;
    state.lastText = text;
    setStatus("Text paused. Starting NaturalReader playback…");
    setTimeout(() => {
      const current = getEditor();
      if (!state.enabled || !current || textOf(current) !== text) { state.running = false; setStatus("Text changed; waiting for you to finish."); return; }
      if (!clickPlay()) { state.running = false; setStatus("Couldn't find NaturalReader's Play button. Text was kept."); return; }
      setStatus("Playing audio… text will clear when playback finishes.");
      waitForPlayback(text);
    }, 300);
  }
  function onEditorChange(e) {
    const el = e.target;
    if (!el || el.closest?.("#nrv-panel") || !el.matches?.('textarea,[contenteditable="true"],[role="textbox"],input')) return;
    const text = textOf(el);
    if (!text) return;
    state.lastText = state.running ? state.lastText : "";
    clearTimeout(state.timer);
    setStatus("Typing/dictation detected. Waiting for a pause…");
    state.timer = setTimeout(() => processText(textOf(el)), state.silenceMs);
  }
  function buildPanel() {
    if (document.querySelector("#nrv-panel")) return;
    const p = document.createElement("section");
    p.id = "nrv-panel";
    Object.assign(p.style,{position:"fixed",right:"14px",bottom:"14px",zIndex:"2147483647",width:"260px",padding:"12px",borderRadius:"12px",background:"#171827",color:"#fff",font:"13px system-ui,sans-serif",boxShadow:"0 8px 30px #0008"});
    p.innerHTML = '<div style="font-weight:750;font-size:14px;margin-bottom:8px">NaturalReader Auto</div><label style="display:flex;align-items:center;gap:7px"><input id="nrv-enabled" type="checkbox" checked> Auto-play after silence</label><label style="display:block;margin-top:8px">Pause before Play <span id="nrv-ms-label">2.2 sec</span><input id="nrv-silence" type="range" min="800" max="5000" step="200" value="2200" style="width:100%"></label><div style="font-size:12px;color:#cbd5e1;margin-top:8px;line-height:1.4">After audio finishes, the text is cleared so you can dictate or enter more.</div><div id="nrv-status" style="margin-top:8px;color:#cbd5e1;line-height:1.35">Ready. Enter or dictate text into NaturalReader.</div><button id="nrv-play-now" style="margin-top:8px;width:100%;border:0;border-radius:7px;padding:7px;background:#4f46e5;color:white;font-weight:650;cursor:pointer">Play now</button>';
    document.documentElement.appendChild(p);
    p.querySelector("#nrv-enabled").onchange = e => { state.enabled = e.target.checked; setStatus(state.enabled ? "Auto-play enabled." : "Auto-play paused."); };
    p.querySelector("#nrv-silence").oninput = e => { state.silenceMs = Number(e.target.value); p.querySelector("#nrv-ms-label").textContent = (state.silenceMs/1000).toFixed(1)+" sec"; };
    p.querySelector("#nrv-play-now").onclick = () => { const e=getEditor(); if(e) processText(textOf(e)); else setStatus("Couldn't find the text editor."); };
    p.addEventListener("mousedown",e=>e.stopPropagation());
  }
  document.addEventListener("input", onEditorChange, true);
  document.addEventListener("change", onEditorChange, true);
  function init() {
    buildPanel();
    setStatus("Ready. Enter or dictate text; Play starts after a pause.");
    // Some editors dispatch programmatic changes that do not bubble as expected.
    setInterval(() => {
      if (!state.enabled || state.running) return;
      const e = getEditor(), text = e ? textOf(e) : "";
      if (text && text !== state.lastText) {
        clearTimeout(state.timer);
        state.timer = setTimeout(() => processText(textOf(e)), state.silenceMs);
      }
    }, 600);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, {once:true}); else init();
})();