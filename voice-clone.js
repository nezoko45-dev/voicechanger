import { env, pipeline } from "@huggingface/transformers";

env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("ort/");

(() => {
  const $ = (s) => document.querySelector(s);
  const loadButton = $("#loadModels"), modelStatus = $("#modelStatus"), progressBar = $("#progressBar"), engineBadge = $("#engineBadge");
  const textInput = $("#text"), dictateButton = $("#dictate"), stopDictationButton = $("#stopDictation"), dictationStatus = $("#dictationStatus");
  const synthesizeButton = $("#synthesize"), stopAudioButton = $("#stopAudio"), synthesisStatus = $("#synthesisStatus"), clips = $("#clips");
  let tts = null, asr = null, loading = false, synthesizing = false, mediaRecorder = null, micStream = null, recordedChunks = [], activeAudio = null, clipNumber = 0;

  function updateControls() {
    dictateButton.disabled = !tts || loading || synthesizing || !!mediaRecorder;
    synthesizeButton.disabled = !tts || !textInput.value.trim() || loading || synthesizing;
    loadButton.disabled = loading || !!tts;
  }
  function status(message) { modelStatus.textContent = message; }
  function setSynthesisStatus(message) { synthesisStatus.textContent = message; }

  async function loadModels() {
    if (loading || tts) return;
    loading = true; updateControls(); progressBar.style.width = "0%";
    try {
      status("Loading Kokoro-82M speech model locally… The first download may take a few minutes.");
      tts = await pipeline("text-to-speech", "onnx-community/Kokoro-82M-v1.0-ONNX", {
        device: navigator.gpu ? "webgpu" : "wasm",
        dtype: navigator.gpu ? "fp32" : "q8",
        progress_callback: (event) => {
          if (event?.status === "progress" && Number.isFinite(event.progress)) {
            progressBar.style.width = Math.max(0, Math.min(100, event.progress)) + "%";
            status("Downloading " + (event.file || "Kokoro model files") + " · " + Math.round(event.progress) + "%");
          }
        }
      });
      engineBadge.textContent = "Kokoro ready";
      status("Kokoro is ready. Choose a built-in voice, then type text or use local dictation.");
      progressBar.style.width = "100%";
    } catch (error) {
      tts = null; engineBadge.textContent = "Model load failed";
      status("Could not load Kokoro: " + (error?.message || String(error)));
    } finally { loading = false; updateControls(); }
  }

  function wavBlob(samples, sampleRate) {
    const pcm = samples instanceof Float32Array ? samples : new Float32Array(samples);
    const buffer = new ArrayBuffer(44 + pcm.length * 2), view = new DataView(buffer);
    const write = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    write(0, "RIFF"); view.setUint32(4, 36 + pcm.length * 2, true); write(8, "WAVE"); write(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, "data"); view.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true); }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function addClip(blob, label) {
    clipNumber++;
    if (clips.querySelector("p")) clips.replaceChildren();
    const url = URL.createObjectURL(blob), card = document.createElement("div"); card.className = "clip";
    const title = document.createElement("strong"); title.textContent = "Clip " + clipNumber + " · " + label;
    const audio = document.createElement("audio"); audio.controls = true; audio.preload = "metadata"; audio.src = url;
    const download = document.createElement("a"); download.href = url; download.download = "kokoro-speech-" + String(clipNumber).padStart(3, "0") + ".wav"; download.textContent = "Download WAV";
    card.append(title, audio, download); clips.prepend(card); return audio;
  }

  async function synthesize() {
    const text = textInput.value.trim(); if (!tts || !text || synthesizing) return;
    synthesizing = true; updateControls(); setSynthesisStatus("Generating speech with Kokoro locally…");
    try {
      const voice = $("#voice").value;
      const result = await tts(text, { voice });
      const samples = result.audio;
      const blob = wavBlob(samples, result.sampling_rate || 24000);
      const audio = addClip(blob, voice);
      if (activeAudio) { try { activeAudio.pause(); } catch {} }
      activeAudio = audio; stopAudioButton.disabled = false;
      setSynthesisStatus("Speech generated locally. Play it here or download the WAV.");
      await audio.play().catch(() => {});
    } catch (error) { setSynthesisStatus("Kokoro synthesis failed: " + (error?.message || String(error))); }
    finally { synthesizing = false; updateControls(); }
  }

  async function getLocalAsr() {
    if (asr) return asr;
    dictationStatus.textContent = "Loading local Whisper dictation model…";
    const hasWebGPU = !!navigator.gpu && !!(await navigator.gpu.requestAdapter());
    asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", {
      device: hasWebGPU ? "webgpu" : "wasm", dtype: hasWebGPU ? "q4" : "q8",
      progress_callback: (event) => { if (event?.status === "progress") dictationStatus.textContent = "Downloading dictation model " + Math.round(event.progress) + "%"; }
    });
    return asr;
  }
  function stopMicTracks() { if (micStream) micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  function resample(input, sourceRate, targetRate) {
    if (sourceRate === targetRate) return input;
    const out = new Float32Array(Math.max(1, Math.round(input.length * targetRate / sourceRate))), ratio = sourceRate / targetRate;
    for (let i = 0; i < out.length; i++) { const p = i * ratio, l = Math.min(input.length - 1, Math.floor(p)), r = Math.min(input.length - 1, l + 1), f = p - l; out[i] = input[l] * (1 - f) + input[r] * f; }
    return out;
  }
  async function transcribeRecording() {
    mediaRecorder = null; stopMicTracks(); stopDictationButton.disabled = true; dictationStatus.textContent = "Transcribing locally…";
    try {
      if (!recordedChunks.length) throw new Error("No microphone audio was captured.");
      const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || "audio/webm" }); recordedChunks = [];
      const ctx = new AudioContext();
      try {
        const decoded = await ctx.decodeAudioData(await blob.arrayBuffer()), samples = resample(decoded.getChannelData(0), decoded.sampleRate, 16000);
        const result = await asr({ raw: samples, sampling_rate: 16000 }), transcript = (result?.text || "").trim();
        if (!transcript) throw new Error("No speech was recognized. Try speaking closer to the microphone.");
        textInput.value = textInput.value.trim() ? textInput.value.trim() + " " + transcript : transcript;
        textInput.dispatchEvent(new Event("input", { bubbles: true }));
        dictationStatus.textContent = "Dictation added"; setSynthesisStatus("Dictation completed on-device. Review the text, then synthesize.");
      } finally { await ctx.close(); }
    } catch (error) { dictationStatus.textContent = "Dictation failed"; setSynthesisStatus("Local dictation failed: " + (error?.message || String(error))); }
    finally { updateControls(); }
  }
  async function startDictation() {
    if (mediaRecorder) return;
    try {
      await getLocalAsr();
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : undefined;
      mediaRecorder = new MediaRecorder(micStream, options); recordedChunks = [];
      mediaRecorder.addEventListener("dataavailable", e => { if (e.data?.size) recordedChunks.push(e.data); });
      mediaRecorder.addEventListener("stop", transcribeRecording, { once: true }); mediaRecorder.start();
      dictationStatus.textContent = "Recording · local"; dictateButton.disabled = true; stopDictationButton.disabled = false;
    } catch (error) { stopMicTracks(); mediaRecorder = null; setSynthesisStatus("Could not start local dictation: " + (error?.message || String(error))); updateControls(); }
  }
  loadButton.addEventListener("click", loadModels);
  textInput.addEventListener("input", updateControls);
  synthesizeButton.addEventListener("click", synthesize);
  dictateButton.addEventListener("click", startDictation);
  stopDictationButton.addEventListener("click", () => { if (mediaRecorder && mediaRecorder.state !== "inactive") { dictationStatus.textContent = "Finishing recording…"; mediaRecorder.stop(); } stopDictationButton.disabled = true; });
  stopAudioButton.disabled = true; stopAudioButton.addEventListener("click", () => { if (activeAudio) { activeAudio.pause(); activeAudio.currentTime = 0; } stopAudioButton.disabled = true; });
  $("#clear").addEventListener("click", () => { for (const audio of clips.querySelectorAll("audio")) { audio.pause(); if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src); } clips.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Generated audio will appear here.", className: "muted" })); clipNumber = 0; });
  window.addEventListener("beforeunload", () => { stopMicTracks(); if (activeAudio) activeAudio.pause(); });
  updateControls();
})();
