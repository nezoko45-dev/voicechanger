import { PocketTTS, StreamingPlayer, chunksToWavBlob } from "./pocket-tts/index.js";

const $ = id => document.getElementById(id);
const status = $("status"), startBtn = $("load"), stopBtn = $("stop"), micSelect = $("mic"), outputSelect = $("output"), meter = $("meter"), silenceSelect = $("silence"), referenceBtn = $("reference"), outputAudio = $("mp3"), testVoiceBtn = $("testVoice"), replayBtn = $("replay"), chooseBtn = $("choose");
let tts = null, player = null, voiceRef = null, running = false, recognition = null, silenceTimer = 0, recoveryTimer = 0, pendingText = "", micStream = null, vadContext = null, vadAnalyser = null, vadFrame = 0, referenceFile = null, generating = false, generation = 0, lastBlob = null, lastFinalText = "", lastFinalAt = 0;
const setStatus = x => status.textContent = x;
const silenceMs = () => Number(silenceSelect?.value || 220);

async function refreshDevices() {
  try {
    const oldMic = micSelect.value, oldOut = outputSelect.value;
    const ds = await navigator.mediaDevices.enumerateDevices();
    micSelect.innerHTML = '<option value="">Default microphone</option>';
    outputSelect.innerHTML = '<option value="">Default output</option>';
    ds.filter(d => d.kind === "audioinput").forEach((d,i) => { const o=document.createElement("option"); o.value=d.deviceId; o.textContent=d.label||`Microphone ${i+1}`; micSelect.appendChild(o); });
    ds.filter(d => d.kind === "audiooutput").forEach((d,i) => { const o=document.createElement("option"); o.value=d.deviceId; o.textContent=d.label||`Speaker ${i+1}`; outputSelect.appendChild(o); });
    if ([...micSelect.options].some(o=>o.value===oldMic)) micSelect.value=oldMic;
    if ([...outputSelect.options].some(o=>o.value===oldOut)) outputSelect.value=oldOut;
  } catch {}
}

async function ensurePlayer() {
  if (!player) player = new StreamingPlayer({ sampleRate: tts.sampleRate, minLead: 0.035, playbackRate: 1.0 });
  await player.resume();
  if (typeof player.audioContext?.setSinkId === "function") await player.setSinkId(outputSelect.value || "default");
}

async function chooseOutput() {
  await ensurePlayer();
  if (typeof player.audioContext?.setSinkId !== "function") { setStatus("Chrome speaker selection is unavailable here; using the default output."); return; }
  await player.setSinkId(outputSelect.value || "default");
  if (typeof outputAudio.setSinkId === "function") await outputAudio.setSinkId(outputSelect.value || "default");
  setStatus("Output device selected.");
}
outputSelect.addEventListener("change", () => chooseOutput().catch(e=>setStatus(`Output error: ${e.message||e}`)));
chooseBtn?.addEventListener("click", () => chooseOutput().catch(e=>setStatus(`Output error: ${e.message||e}`)));

async function loadPocketTTS() {
  if (tts?.ready) return;
  setStatus("Loading Pocket TTS in Chrome… the first load downloads the browser model and caches it.");
  tts = new PocketTTS({ language:"english_2026-04", quantized:true, voiceCloning:true, cache:true, maxThreads:1, maxReferenceSeconds:6 });
  await tts.load(info => {
    if (info?.label) setStatus(`Pocket TTS: ${info.label}${info.fromCache ? " (cached)" : ""}`);
    if (info?.loaded && info?.total) meter.style.width = `${Math.min(100, info.loaded/info.total*100)}%`;
  });
}

function pickReference() {
  return new Promise(resolve => { const p=document.createElement("input"); p.type="file"; p.accept=".wav,audio/wav"; p.onchange=()=>resolve(p.files?.[0]||null); p.click(); });
}

async function decodeReference(file) {
  const ctx = new AudioContext();
  try {
    const a = await ctx.decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(a.length);
    for (let i=0;i<a.length;i++) { let s=0; for(let c=0;c<a.numberOfChannels;c++) s+=a.getChannelData(c)[i]; mono[i]=s/a.numberOfChannels; }
    return { data:mono, sampleRate:a.sampleRate, duration:a.duration };
  } finally { await ctx.close().catch(()=>{}); }
}

async function cloneReference() {
  if (!referenceFile) throw new Error("Choose a reference WAV first.");
  await loadPocketTTS();
  setStatus(`Reading ${referenceFile.name}…`);
  const wav = await decodeReference(referenceFile);
  if (wav.duration < 0.5) throw new Error("Reference WAV is too short. Use a clear 1–6 second sample.");
  setStatus("Cloning your WAV in the browser…");
  voiceRef = await tts.cloneVoice(wav.data, { inputSampleRate:wav.sampleRate, name:"my-wav-voice" });
  setStatus("Voice embedding ready. Loading Pocket TTS synthesis…");
  await tts.finishLoad();
  setStatus("YOUR CUSTOM WAV VOICE IS READY.");
}

referenceBtn.addEventListener("click", async()=>{
  const f=await pickReference();
  if(!f) return;
  referenceFile=f; voiceRef=null;
  try { await cloneReference(); } catch(e) { setStatus(`WAV clone failed: ${e.message||e}`); }
});

function stopMic() {
  if(vadFrame) cancelAnimationFrame(vadFrame); vadFrame=0;
  try{vadAnalyser?.disconnect()}catch{} try{vadContext?.close()}catch{}
  vadAnalyser=null; vadContext=null;
  micStream?.getTracks().forEach(t=>t.stop()); micStream=null;
}

async function startMic() {
  stopMic();
  const audio = { echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 };
  if(micSelect.value) audio.deviceId={exact:micSelect.value};
  micStream=await navigator.mediaDevices.getUserMedia({audio});
  vadContext=new AudioContext({latencyHint:"interactive"});
  await vadContext.resume();
  const source=vadContext.createMediaStreamSource(micStream);
  vadAnalyser=vadContext.createAnalyser(); vadAnalyser.fftSize=512; vadAnalyser.smoothingTimeConstant=.1; source.connect(vadAnalyser);
  const data=new Uint8Array(vadAnalyser.fftSize);
  const tick=()=>{ if(!running)return; vadAnalyser.getByteTimeDomainData(data); let s=0; for(const v of data){const x=(v-128)/128;s+=x*x;} meter.style.width=`${Math.min(100,Math.max(2,Math.sqrt(s/data.length)*500))}%`; vadFrame=requestAnimationFrame(tick); };
  vadFrame=requestAnimationFrame(tick);
}

function normalizeSpeech(text) {
  return text.replace(/\s+/g," ").trim().replace(/[\u200B-\u200D\uFEFF]/g,"");
}

function queueFinalSpeech(text) {
  text = normalizeSpeech(text);
  if (!text) return;
  const now = performance.now();
  // Chrome can repeat the same finalized result after a recognition restart.
  if (text === lastFinalText && now - lastFinalAt < 2500) return;
  lastFinalText = text;
  lastFinalAt = now;
  // Do not append interim hypotheses. Only finalized recognition text reaches TTS.
  pendingText = pendingText ? `${pendingText} ${text}` : text;
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    const phrase = normalizeSpeech(pendingText);
    pendingText = "";
    if (phrase) speak(phrase);
  }, silenceMs());
}

async function speak(text) {
  text=normalizeSpeech(text);
  if(!text||!voiceRef||generating)return;
  const id=++generation; generating=true;
  try {
    await ensurePlayer();
    await tts.stop();
    player.reset();
    setStatus(`Speaking with your WAV voice: “${text}”`);
    const chunks=[];
    await tts.generate(text,{voice:voiceRef,onChunk:(chunk,meta)=>{
      if(id!==generation)return;
      const copy=chunk.slice();
      chunks.push(copy);
      player.play(copy,meta);
    }});
    if(id===generation&&chunks.length){
      player.flush();
      lastBlob=chunksToWavBlob(chunks,tts.sampleRate);
      if(outputAudio.src)URL.revokeObjectURL(outputAudio.src);
      outputAudio.src=URL.createObjectURL(lastBlob);
      outputAudio.load();
      setStatus("YOUR CUSTOM WAV VOICE IS ON — Listening…");
    }
  } catch(e) { if(id===generation)setStatus(`TTS failed: ${e.message||e}`); }
  finally { if(id===generation)generating=false; }
}

testVoiceBtn?.addEventListener("click",async()=>{try{if(!voiceRef)await cloneReference();await speak("This is a test of my custom cloned voice.")}catch(e){setStatus(`Test failed: ${e.message||e}`)}});
replayBtn?.addEventListener("click",()=>{if(!outputAudio.src)return setStatus("No generated speech yet.");outputAudio.currentTime=0;outputAudio.play().catch(()=>setStatus("Press PLAY on the audio player."));});

function startRecognition() {
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR) throw new Error("Chrome Speech Recognition is unavailable. Use Chrome.");
  recognition=new SR();
  recognition.lang="en-US";
  recognition.continuous=true;
  recognition.interimResults=true;
  recognition.maxAlternatives=1;
  recognition.onstart=()=>setStatus("YOUR CUSTOM WAV VOICE IS ON — Listening…");
  recognition.onresult=e=>{
    // CRITICAL: only consume finalized results. Interim hypotheses constantly change
    // and appending them was the source of repeated words/phrases.
    for(let i=e.resultIndex;i<e.results.length;i++){
      const r=e.results[i];
      if(r.isFinal) queueFinalSpeech(r[0]?.transcript||"");
    }
  };
  recognition.onerror=e=>{if(running&&e.error!=="aborted")setStatus(`Speech recognition: ${e.error}`);};
  recognition.onend=()=>{
    if(running){
      clearTimeout(recoveryTimer);
      recoveryTimer=setTimeout(()=>{
        if(!running)return;
        try{recognition.start()}catch{}
      },150);
    }
  };
  recognition.start();
}

startBtn.addEventListener("click",async()=>{
  if(running)return;
  try {
    await navigator.mediaDevices.getUserMedia({audio:true});
    await refreshDevices(); await loadPocketTTS(); await ensurePlayer();
    if(!referenceFile) referenceFile=await pickReference();
    if(!referenceFile) throw new Error("Choose a WAV reference.");
    if(!voiceRef) await cloneReference();
    running=true; startBtn.disabled=true;
    await startMic(); startRecognition();
  } catch(e) { running=false; startBtn.disabled=false; stopMic(); setStatus(`Start failed: ${e.message||e}`); console.error(e); }
});

stopBtn.addEventListener("click",async()=>{
  running=false; generation++; generating=false; pendingText=""; lastFinalText=""; lastFinalAt=0; clearTimeout(silenceTimer); clearTimeout(recoveryTimer);
  try{recognition?.abort()}catch{} stopMic(); try{await tts?.stop()}catch{} try{player?.stop()}catch{} meter.style.width="0%"; startBtn.disabled=false; setStatus("Stopped.");
});

micSelect.addEventListener("change",async()=>{if(running){try{await startMic();setStatus("Microphone changed — Listening…")}catch(e){setStatus(`Microphone error: ${e.message||e}`)}}});
navigator.mediaDevices?.addEventListener?.("devicechange",refreshDevices);
refreshDevices();
