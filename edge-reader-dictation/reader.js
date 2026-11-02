(() => {
const $ = id => document.getElementById(id);
const textBox = $("text"), status = $("status"), startBtn = $("start"), stopBtn = $("stop");
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let listening = false;
let speaking = false;
let restartTimer = null;
let retryDelay = 800;
let selectedVoice = null;
let autoQueue = [];
let sessionNumber = 0;

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
  const needsSpace = before.length && !/[\\s]$/.test(before);
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

// Every ended browser recognition session is replaced with a NEW instance.
// This avoids trying to restart an expired SpeechRecognition object.
function scheduleNewSession(delay = retryDelay) {
  clearTimeout(restartTimer);
  if (!listening || speaking) return;
  restartTimer = setTimeout(() => {
    if (listening && !speaking) startRecognitionSession();
  }, delay);
}

function startRecognitionSession() {
  if (!listening || speaking || !SpeechRecognition) return;
  clearTimeout(restartTimer);

  const thisSession = ++sessionNumber;
  let instance;
  try {
    instance = new SpeechRecognition();
    recognition = instance;
    instance.lang = "en-US";
    instance.continuous = true;
    instance.interimResults = true;
    instance.maxAlternatives = 1;

    instance.onstart = () => {
      if (thisSession !== sessionNumber) return;
      retryDelay = 800;
      setStatus("Microphone active — listening. A fresh session will start automatically whenever Edge ends one.");
    };

    instance.onresult = event => {
      if (thisSession !== sessionNumber || !listening) return;
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

    instance.onerror = event => {
      if (thisSession !== sessionNumber) return;
      const err = event.error || "unknown";
      if (err === "not-allowed" || err === "service-not-allowed") {
        listening = false;
        recognition = null;
        clearTimeout(restartTimer);
        setListeningUI();
        setStatus("Microphone or speech recognition permission was denied. Allow microphone access in Edge site settings.", false);
        return;
      }
      if (err === "network") {
        setStatus("Speech service disconnected. Creating a fresh recognition session…");
        retryDelay = Math.min(Math.max(retryDelay * 2, 1500), 10000);
      } else if (err === "no-speech") {
        setStatus("No speech detected. Keeping the microphone session ready…");
        retryDelay = 800;
      } else if (err !== "aborted") {
        setStatus("Recognition session ended (" + err + "). Reconnecting…");
        retryDelay = Math.min(retryDelay * 1.5, 10000);
      }
    };

    instance.onend = () => {
      if (thisSession !== sessionNumber) return;
      if (recognition === instance) recognition = null;
      if (!listening || speaking) return;
      setStatus("Session ended — starting a fresh microphone recognition session…");
      scheduleNewSession(retryDelay);
    };

    instance.start();
  } catch (error) {
    if (recognition === instance) recognition = null;
    if (!listening) return;
    setStatus("Could not start recognition. Retrying with a new session…");
    retryDelay = Math.min(Math.max(retryDelay * 1.5, 1200), 10000);
    scheduleNewSession(retryDelay);
  }
}

function startRecognition() {
  if (!SpeechRecognition) {
    setStatus("Speech recognition is not supported here. Use current Microsoft Edge and check microphone permissions.", false);
    return;
  }
  if (listening) return;
  listening = true;
  retryDelay = 800;
  setListeningUI();
  setStatus("Starting microphone recognition…");
  startRecognitionSession();
}

function stopRecognition() {
  listening = false;
  clearTimeout(restartTimer);
  sessionNumber++;
  const old = recognition;
  recognition = null;
  if (old) {
    old.onend = null;
    old.onerror = null;
    try { old.abort(); } catch {}
  }
  setListeningUI();
  setStatus("Dictation stopped.", false);
}

function queueAutoSentence(sentence) {
  autoQueue.push(sentence);
  if (!speaking) playNextAutoSentence();
}
function playNextAutoSentence() {
  if (!autoQueue.length) {
    speaking = false;
    if (listening) scheduleNewSession(300);
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
    const old = recognition;
    recognition = null;
    sessionNumber++;
    old.onend = null;
    old.onerror = null;
    try { old.abort(); } catch {}
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
    if (listening) {
      setStatus("Reading finished — reopening microphone recognition…");
      scheduleNewSession(300);
    } else setStatus("Finished reading.", false);
  };
  utterance.onerror = e => {
    speaking = false;
    setStatus("Speech playback error: " + e.error, false);
    if (autoQueue.length) playNextAutoSentence();
    else if (listening) scheduleNewSession(500);
  };
  speechSynthesis.speak(utterance);
}

startBtn.addEventListener("click", startRecognition);
stopBtn.addEventListener("click", stopRecognition);
$("clear").addEventListener("click", () => { textBox.value = ""; setStatus("Text cleared."); });
$("speak").addEventListener("click", () => speakText(textBox.value, $("clearAfter").checked));
$("pause").addEventListener("click", () => { speechSynthesis.pause(); $("pause").disabled = true; $("resume").disabled = false; });
$("resume").addEventListener("click", () => { speechSynthesis.resume(); $("pause").disabled = false; $("resume").disabled = true; });
$("cancel").addEventListener("click", () => {
  autoQueue = [];
  speechSynthesis.cancel();
  speaking = false;
  if (listening) scheduleNewSession(300);
  else setStatus("Reading stopped.", false);
});
$("voice").addEventListener("change", () => { selectedVoice = speechSynthesis.getVoices()[Number($("voice").value)] || null; });
$("rate").addEventListener("input", e => $("rateValue").textContent = Number(e.target.value).toFixed(2) + "×");
$("pitch").addEventListener("input", e => $("pitchValue").textContent = Number(e.target.value).toFixed(2));
if (!SpeechRecognition) {
  setStatus("Speech recognition is unavailable. Open this page in current Microsoft Edge and allow microphone access.", false);
  startBtn.disabled = true;
}
window.addEventListener("beforeunload", () => {
  listening = false;
  clearTimeout(restartTimer);
  sessionNumber++;
  if (recognition) try { recognition.abort(); } catch {}
});
})();