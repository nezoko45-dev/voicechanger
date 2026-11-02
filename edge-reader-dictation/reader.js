(() => {
const $ = id => document.getElementById(id);
const textBox = $("text"), status = $("status"), startBtn = $("start"), stopBtn = $("stop");
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null, listening = false, restarting = false, speaking = false;
let restartTimer = null, refreshTimer = null, retryDelay = 800, selectedVoice = null;
let autoQueue = [];

function setStatus(message, active = listening) {
  status.innerHTML = '<span class="dot' + (active ? ' on' : '') + '"></span>';
  status.append(document.createTextNode(message));
}
function setListeningUI() {
  startBtn.disabled = listening || !SpeechRecognition;
  stopBtn.disabled = !listening;
}
function getVoices() {
  const voices = speechSynthesis.getVoices();
  const select = $("voice"), previous = select.value;
  select.innerHTML = "";
  voices.forEach((voice, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = voice.name + " — " + voice.lang + (voice.default ? " (default)" : "");
    select.appendChild(option);
  });
  const preferred = voices.findIndex(v => /Microsoft/i.test(v.name) && /en-US/i.test(v.lang) && /(Aria|Jenny|Michelle|Sonia|Ana|Ava|Emma)/i.test(v.name));
  const fallback = voices.findIndex(v => /Microsoft/i.test(v.name) && /en/i.test(v.lang));
  const chosen = voices.some((v,i)=>String(i)===previous) ? Number(previous) : (preferred >= 0 ? preferred : fallback);
  if (chosen >= 0) select.value = String(chosen);
  selectedVoice = voices[Number(select.value)] || null;
}
if ("speechSynthesis" in window) {
  getVoices();
  speechSynthesis.onvoiceschanged = getVoices;
} else setStatus("Speech synthesis is not available in this browser.", false);

function appendTranscript(value) {
  if (!value) return;
  const before = textBox.value;
  const needsSpace = before.length && !/[\s]$/.test(before);
  textBox.value = before + (needsSpace ? " " : "") + value.trim();
  textBox.scrollTop = textBox.scrollHeight;
  if ($("autoRead").checked) {
    const parts = value.match(/[^.!?]+[.!?]+(?:[”"'’)]*)/g);
    if (parts) parts.forEach(sentence => {
      const clean = sentence.trim();
      if (clean) queueAutoSentence(clean);
    });
  }
}
function scheduleRestart(delay = retryDelay) {
  clearTimeout(restartTimer);
  if (!listening || speaking) return;
  restarting = true;
  restartTimer = setTimeout(() => {
    if (!listening || speaking || !recognition) return;
    try { recognition.start(); }
    catch (e) { scheduleRestart(Math.min(retryDelay * 1.5, 10000)); }
  }, delay);
}
function startRecognition() {
  if (!SpeechRecognition) {
    setStatus("Speech recognition is not supported here. Use current Microsoft Edge and check microphone permissions.", false);
    return;
  }
  if (listening) return;
  listening = true; retryDelay = 800; setListeningUI();
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    restarting = false; retryDelay = 800;
    setStatus("Listening… speak naturally. Recognition will refresh automatically.");
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (listening && !speaking && recognition) {
        setStatus("Refreshing speech recognition session…");
        try { recognition.stop(); } catch {}
      }
    }, 50000);
  };
  recognition.onresult = event => {
    let finalText = "";
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    if (finalText) appendTranscript(finalText);
    if (interim) setStatus("Listening… " + interim);
    else if (listening) setStatus("Listening…");
  };
  recognition.onerror = event => {
    const err = event.error || "unknown";
    if (err === "not-allowed" || err === "service-not-allowed") {
      listening = false; clearTimeout(refreshTimer); setListeningUI();
      setStatus("Microphone or speech recognition permission was denied. Allow microphone access in Edge site settings.", false);
      return;
    }
    if (err === "network") {
      setStatus("Speech recognition network error. Retrying automatically…");
      retryDelay = Math.min(Math.max(retryDelay * 2, 1500), 10000);
    } else if (err === "no-speech") {
      setStatus("No speech detected. Keeping dictation active…");
      retryDelay = 800;
    } else if (err !== "aborted") {
      setStatus("Speech recognition issue (" + err + "). Retrying…");
      retryDelay = Math.min(retryDelay * 1.5, 10000);
    }
  };
  recognition.onend = () => {
    clearTimeout(refreshTimer);
    if (!listening || speaking) return;
    setStatus("Restarting speech recognition…");
    scheduleRestart(retryDelay);
  };
  try { recognition.start(); }
  catch (e) { setStatus("Could not start recognition. Retrying…"); scheduleRestart(1500); }
}
function stopRecognition() {
  listening = false; restarting = false;
  clearTimeout(restartTimer); clearTimeout(refreshTimer);
  if (recognition) { try { recognition.abort(); } catch {} recognition = null; }
  setListeningUI(); setStatus("Dictation stopped.", false);
}
function queueAutoSentence(sentence) {
  autoQueue.push(sentence);
  if (!speaking) playNextAutoSentence();
}
function playNextAutoSentence() {
  if (!autoQueue.length) {
    speaking = false;
    if (listening) scheduleRestart(500);
    return;
  }
  playUtterance(autoQueue.shift(), false);
}
function speakText(value, clearAfter) {
  const content = (value || "").trim();
  if (!content || !("speechSynthesis" in window)) return;
  autoQueue = [];
  speechSynthesis.cancel();
  speaking = false;
  playUtterance(content, clearAfter);
}
function playUtterance(content, clearAfter) {
  if (recognition && listening) {
    speaking = true;
    clearTimeout(restartTimer); clearTimeout(refreshTimer);
    try { recognition.stop(); } catch {}
  }
  const utterance = new SpeechSynthesisUtterance(content);
  const voices = speechSynthesis.getVoices();
  selectedVoice = voices[Number($("voice").value)] || selectedVoice;
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.rate = Number($("rate").value);
  utterance.pitch = Number($("pitch").value);
  utterance.onstart = () => setStatus("Reading aloud…", false);
  utterance.onend = () => {
    if (clearAfter) textBox.value = "";
    if (autoQueue.length) { playNextAutoSentence(); return; }
    speaking = false;
    if (listening) { setStatus("Resuming dictation…"); scheduleRestart(500); }
    else setStatus("Finished reading.", false);
  };
  utterance.onerror = e => {
    speaking = false;
    setStatus("Speech playback error: " + e.error, false);
    if (autoQueue.length) playNextAutoSentence();
    else if (listening) scheduleRestart(700);
  };
  speechSynthesis.speak(utterance);
}
startBtn.addEventListener("click", startRecognition);
stopBtn.addEventListener("click", stopRecognition);
$("clear").addEventListener("click", () => { textBox.value = ""; setStatus("Text cleared."); });
$("speak").addEventListener("click", () => speakText(textBox.value, $("clearAfter").checked));
$("pause").addEventListener("click", () => { speechSynthesis.pause(); $("pause").disabled = true; $("resume").disabled = false; });
$("resume").addEventListener("click", () => { speechSynthesis.resume(); $("pause").disabled = false; $("resume").disabled = true; });
$("cancel").addEventListener("click", () => { autoQueue = []; speechSynthesis.cancel(); speaking = false; if (listening) scheduleRestart(500); else setStatus("Reading stopped.", false); });
$("voice").addEventListener("change", () => { selectedVoice = speechSynthesis.getVoices()[Number($("voice").value)] || null; });
$("rate").addEventListener("input", e => $("rateValue").textContent = Number(e.target.value).toFixed(2) + "×");
$("pitch").addEventListener("input", e => $("pitchValue").textContent = Number(e.target.value).toFixed(2));
if (!SpeechRecognition) {
  setStatus("Speech recognition is unavailable. Open this page in current Microsoft Edge and allow microphone access.", false);
  startBtn.disabled = true;
}
window.addEventListener("beforeunload", () => { listening = false; clearTimeout(restartTimer); clearTimeout(refreshTimer); if (recognition) try { recognition.abort(); } catch {} });
})();