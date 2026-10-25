(() => {
  if (window.__doppleVoiceCaptionInstalled) return;
  window.__doppleVoiceCaptionInstalled = true;

  const state = { auto: true, lastText: "", voice: null, rate: 1, pitch: 1.12, observer: null, scanTimer: null };
  const $ = (s, root=document) => root.querySelector(s);
  const clean = s => (s || "").replace(/\s+/g, " ").trim();
  const ignored = new Set(["read aloud", "copy", "regenerate", "edit", "like", "dislike", "share", "retry", "stop generating"]);

  function chooseFemaleVoice() {
    const voices = speechSynthesis.getVoices() || [];
    const english = voices.filter(v => /^en([-_]|$)/i.test(v.lang));
    const femaleHints = /female|woman|girl|samantha|victoria|karen|zira|aria|jenny|sara|susan|hazel|libby|natasha|ava|emma|michelle|luna|google us english/i;
    return english.find(v => femaleHints.test(v.name)) || english.find(v => /google|microsoft|natural|online/i.test(v.name)) || english[0] || voices[0] || null;
  }
  function setStatus(s) { const e = $("#dvc-status"); if (e) e.textContent = s; }
  function showCaption(text) {
    let e = $("#dvc-caption");
    if (!e) {
      e = document.createElement("div"); e.id = "dvc-caption";
      Object.assign(e.style, {position:"fixed",left:"50%",bottom:"78px",transform:"translateX(-50%)",zIndex:"2147483647",maxWidth:"min(80vw,900px)",padding:"10px 16px",borderRadius:"12px",background:"rgba(15,18,28,.92)",color:"#fff",font:"16px/1.45 system-ui,sans-serif",textAlign:"center",boxShadow:"0 4px 22px #0006",pointerEvents:"none",display:"none"});
      document.documentElement.appendChild(e);
    }
    e.textContent = text; e.style.display = text ? "block" : "none";
  }
  function speak(text) {
    text = clean(text);
    if (!text) { setStatus("No reply text found. Try Read latest."); return; }
    if (!("speechSynthesis" in window)) { setStatus("Speech synthesis is not supported by this browser."); return; }
    speechSynthesis.cancel();
    state.lastText = text;
    state.voice = chooseFemaleVoice();
    const utter = new SpeechSynthesisUtterance(text);
    if (state.voice) utter.voice = state.voice;
    utter.lang = state.voice?.lang || "en-US";
    utter.rate = state.rate; utter.pitch = state.pitch;
    showCaption(text);
    setStatus("Speaking" + (state.voice ? " with " + state.voice.name : " with the default voice") + "…");
    utter.onend = () => { setStatus("Finished reading."); setTimeout(() => { const c=$("#dvc-caption"); if(c) c.style.display="none"; }, 1800); };
    utter.onerror = ev => setStatus("Voice playback error: " + (ev.error || "unknown error") + ". Press Test voice.");
    speechSynthesis.speak(utter);
  }
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
  }
  function looksLikeUser(el) {
    const info = [el.getAttribute("data-role"),el.getAttribute("role"),el.getAttribute("data-author"),el.className,el.parentElement?.className].join(" ").toLowerCase();
    return /user-message|message-user|user-bubble|from-user|author-user|human-message/.test(info) ||
      el.getAttribute("data-role") === "user" || el.getAttribute("data-author") === "user";
  }
  function textFrom(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll("button,[role=button],svg,textarea,input,script,style,[aria-label],.dvc-control").forEach(n => n.remove());
    return clean(clone.innerText || clone.textContent || "");
  }
  function findLatestReply() {
    const selectors = [
      '[data-message-author-role="assistant"]','[data-role="assistant"]','[data-author="assistant"]',
      '[data-testid*="assistant" i]','[class*="assistant-message" i]','[class*="bot-message" i]',
      '[class*="character-message" i]','[class*="ai-message" i]','[class*="message-content" i]',
      '[class*="markdown" i]','main article','main [class*="message" i]','main [class*="chat" i]'
    ];
    const all = [];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => {
        if (!isVisible(el) || looksLikeUser(el) || el.closest("#dvc-panel") || el.closest("#dvc-caption")) return;
        const t = textFrom(el);
        if (t.length < 2 || ignored.has(t.toLowerCase()) || /^(you|you:|assistant:?)$/i.test(t)) return;
        if (t.length > 12000) return;
        all.push({el,t});
      });
    }
    // Prefer explicit assistant-labelled nodes; otherwise take the most recent substantial
    // non-user text block in the main chat area, excluding controls and navigation.
    const explicit = all.filter(x => {
      const s = [x.el.getAttribute("data-message-author-role"),x.el.getAttribute("data-role"),x.el.getAttribute("data-author"),x.el.className].join(" ").toLowerCase();
      return /assistant|bot-message|character-message|ai-message/.test(s);
    });
    const pool = explicit.length ? explicit : all;
    pool.sort((a,b) => {
      if (a.el.contains(b.el)) return -1;
      if (b.el.contains(a.el)) return 1;
      return (b.el.getBoundingClientRect().bottom || 0) - (a.el.getBoundingClientRect().bottom || 0);
    });
    // Remove duplicates/nested wrappers by choosing the most text-rich likely latest node.
    const seen = new Set();
    for (const item of pool) {
      if (seen.has(item.t)) continue;
      seen.add(item.t);
    }
    return pool.sort((a,b) => (b.el.getBoundingClientRect().bottom || 0) - (a.el.getBoundingClientRect().bottom || 0))[0]?.t || "";
  }
  function readLatest() { const t = findLatestReply(); if (!t) { setStatus("Couldn't identify a reply. Select its text and use Read selected text."); return; } speak(t); }
  function buildPanel() {
    if ($("#dvc-panel")) return;
    const panel = document.createElement("section"); panel.id = "dvc-panel";
    Object.assign(panel.style,{position:"fixed",right:"14px",bottom:"14px",zIndex:"2147483647",width:"250px",padding:"12px",borderRadius:"14px",background:"#171827",color:"#f8fafc",font:"13px system-ui,sans-serif",boxShadow:"0 8px 30px #0008"});
    panel.innerHTML = '<div style="font-weight:750;font-size:14px;margin-bottom:8px">Dopple Voice Caption</div><div style="display:flex;gap:6px"><button id="dvc-read">Read latest</button><button id="dvc-test">Test voice</button></div><label style="display:flex;align-items:center;gap:7px;margin-top:9px"><input id="dvc-auto" type="checkbox" checked> Auto-read new replies</label><label style="display:block;margin-top:8px">Voice<select id="dvc-voice" style="display:block;width:100%;margin-top:4px;padding:6px;border-radius:7px"></select></label><label style="display:block;margin-top:8px">Test caption text<input id="dvc-custom" value="Hi! I'm ready to read your Dopple replies aloud." style="box-sizing:border-box;width:100%;margin-top:4px;padding:6px;border-radius:7px"></label><div style="display:flex;gap:6px;margin-top:8px"><button id="dvc-stop">Stop</button><button id="dvc-hide">Hide captions</button></div><div id="dvc-status" style="margin-top:8px;color:#cbd5e1;line-height:1.35">Ready. Click Read latest to test.</div>';
    document.documentElement.appendChild(panel);
    panel.querySelectorAll("button").forEach(b=>Object.assign(b.style,{flex:"1",border:"0",borderRadius:"7px",padding:"7px 5px",background:"#4f46e5",color:"#fff",fontWeight:"650",cursor:"pointer"}));
    const select = $("#dvc-voice");
    function fillVoices() {
      const voices = speechSynthesis.getVoices() || [];
      select.innerHTML = "";
      const english = voices.filter(v => /^en([-_]|$)/i.test(v.lang));
      const list = english.length ? english : voices;
      list.forEach(v => { const o=document.createElement("option"); o.value=v.name; o.textContent=v.name+" ("+v.lang+")"; select.appendChild(o); });
      const preferred = chooseFemaleVoice(); if (preferred) select.value=preferred.name;
    }
    fillVoices(); speechSynthesis.onvoiceschanged = fillVoices;
    select.addEventListener("change",()=>{state.voice=(speechSynthesis.getVoices()||[]).find(v=>v.name===select.value)||null;});
    $("#dvc-read").onclick = readLatest;
    $("#dvc-test").onclick = () => speak($("#dvc-custom").value || "Hello! This is a test of the Dopple voice caption extension.");
    $("#dvc-stop").onclick = () => { speechSynthesis.cancel(); showCaption(""); setStatus("Stopped."); };
    $("#dvc-hide").onclick = () => showCaption("");
    $("#dvc-auto").onchange = e => { state.auto=e.target.checked; setStatus(state.auto?"Auto-read enabled.":"Auto-read disabled."); };
    panel.addEventListener("mousedown", e => e.stopPropagation());
  }
  function scanForNewReply() {
    if (!state.auto || speechSynthesis.speaking) return;
    const t = findLatestReply();
    if (t && t.length > 3 && t !== state.lastText) {
      // Wait briefly for streaming replies to finish updating before speaking.
      clearTimeout(state.scanTimer);
      state.scanTimer = setTimeout(() => {
        const latest = findLatestReply();
        if (latest && latest !== state.lastText) speak(latest);
      }, 1100);
    }
  }
  function startObserver() {
    if (state.observer) state.observer.disconnect();
    state.observer = new MutationObserver(() => scanForNewReply());
    state.observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
    setInterval(scanForNewReply,1800);
  }
  document.addEventListener("mouseup", () => {
    const selected = clean(window.getSelection()?.toString());
    if (selected && selected.length > 1) {
      // Expose selected text through a tiny unobtrusive action.
      let btn=$("#dvc-selection");
      if (!btn) { btn=document.createElement("button"); btn.id="dvc-selection"; btn.textContent="Speak selected text"; Object.assign(btn.style,{position:"fixed",right:"14px",bottom:"310px",zIndex:"2147483647",padding:"8px 10px",borderRadius:"8px",border:"0",background:"#db2777",color:"#fff",cursor:"pointer"}); document.documentElement.appendChild(btn); }
      btn.style.display="block"; btn.onclick=()=>speak(window.getSelection()?.toString() || selected);
      clearTimeout(btn._hideTimer); btn._hideTimer=setTimeout(()=>btn.style.display="none",5000);
    }
  });
  chrome.runtime?.onMessage?.addListener((msg, sender, reply) => {
    if (msg?.action === "READ_LATEST") { readLatest(); reply({ok:true}); }
    else if (msg?.action === "TEST_VOICE") { speak("Hi! I'm ready to read your Dopple replies aloud."); reply({ok:true}); }
    else if (msg?.action === "STOP") { speechSynthesis.cancel(); showCaption(""); setStatus("Stopped."); reply({ok:true}); }
    return true;
  });
  function init() {
    buildPanel();
    startObserver();
    speechSynthesis.getVoices();
    setStatus("Ready. Click Read latest or enable Auto-read.");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",init,{once:true}); else init();
})();