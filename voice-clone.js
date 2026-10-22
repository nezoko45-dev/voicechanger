import { ChatterboxEngine, VoxShot } from "voxshot";
import { pipeline } from "@huggingface/transformers";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const loadButton = $("#loadModels");
  const modelStatus = $("#modelStatus");
  const progressBar = $("#progressBar");
  const engineBadge = $("#engineBadge");
  const referenceInput = $("#reference");
  const setReferenceButton = $("#setReference");
  const referenceStatus = $("#referenceStatus");
  const textInput = $("#text");
  const dictateButton = $("#dictate");
  const stopDictationButton = $("#stopDictation");
  const dictationStatus = $("#dictationStatus");
  const synthesizeButton = $("#synthesize");
  const stopAudioButton = $("#stopAudio");
  const synthesisStatus = $("#synthesisStatus");
  const clips = $("#clips");
  const stopDictationButtonInitialText = stopDictationButton.textContent;

  let tts = null;
  let asr = null;
  let referenceFile = null;
  let loading = false;
  let synthesizing = false;
  let mediaRecorder = null;
  let micStream = null;
  let recordedChunks = [];
  let activeAudio = null;
  let clipNumber = 0;

  function setModelStatus(message) { modelStatus.textContent = message; }
  function setSynthesisStatus(message) { synthesisStatus.textContent = message; }
  function updateControls() {
    setReferenceButton.disabled = !tts || !referenceInput.files?.[0] || loading;
    dictateButton.disabled = !tts || loading || synthesizing || !!mediaRecorder;
    synthesizeButton.disabled = !tts || !referenceFile || !textInput.value.trim() || loading || synthesizing;
    loadButton.disabled = loading;
  }
  function reportModelProgress(event) {
    if (!event) return;
    if (event.status === "progress" && Number.isFinite(event.progress)) {
      progressBar.style.width = Math.max(0, Math.min(100, event.progress)) + "%";
      setModelStatus("Downloading " + (event.file || "model files") + " · " + Math.round(event.progress) + "%");
    } else if (event.status === "load-start") {
      setModelStatus("Preparing " + (event.plan || "WebGPU") + "…");
    } else if (event.status === "load-fallback") {
      setModelStatus("WebGPU model plan failed: " + (event.reason || "unknown reason"));
    } else if (event.status === "load-ready") {
      setModelStatus("Voice model ready on " + (event.plan || "WebGPU") + ".");
    } else if (event.status === "load-compiling") {
      setModelStatus("Model files downloaded. Compiling GPU sessions; this can take a few minutes…");
      progressBar.style.width = "100%";
    }
  }

  async function loadModels() {
    if (loading || tts) return;
    loading = true;
    updateControls();
    try {
      if (!navigator.gpu) throw new Error("WebGPU is unavailable. Try a recent Chrome or Edge build with WebGPU enabled.");
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("No WebGPU adapter was found. Check your browser and graphics drivers.");
      setModelStatus("Starting Chatterbox WebGPU voice model…");
      progressBar.style.width = "0%";
      const engine = new ChatterboxEngine({
        requiresGpu: true,
        onProgress: reportModelProgress,
      });
      tts = await VoxShot.create({ engine, device: "webgpu", minChunkLength: 20 });
      if (tts.device && !String(tts.device).startsWith("webgpu")) {
        const selectedDevice = tts.device;
        await tts.dispose();
        tts = null;
        throw new Error("The voice engine did not stay on WebGPU (selected " + selectedDevice + ").");
      }
      engineBadge.textContent = "Voice model ready · WebGPU";
      setModelStatus("Voice model ready. Next, select a reference WAV.");
      progressBar.style.width = "100%";
    } catch (error) {
      engineBadge.textContent = "Model load failed";
      setModelStatus("Could not load the WebGPU voice model: " + (error?.message || String(error)));
    } finally {
      loading = false;
      updateControls();
    }
  }

  referenceInput.addEventListener("change", () => {
    const file = referenceInput.files?.[0] || null;
    referenceStatus.textContent = file ? file.name + " selected; click Use this reference voice." : "No reference selected.";
    setReferenceButton.disabled = !tts || !file || loading;
  });

  setReferenceButton.addEventListener("click", async () => {
    const file = referenceInput.files?.[0];
    if (!file || !tts) return;
    if (!file.name.toLowerCase().endsWith(".wav") && file.type !== "audio/wav" && file.type !== "audio/x-wav") {
      referenceStatus.textContent = "Please choose a WAV file.";
      return;
    }
    setReferenceButton.disabled = true;
    referenceStatus.textContent = "Preparing reference voice locally…";
    try {
      await tts.cloneVoice(file);
      referenceFile = file;
      referenceStatus.textContent = "Reference voice ready: " + file.name;
      setSynthesisStatus("Reference voice set. Enter text or use local dictation.");
    } catch (error) {
      referenceFile = null;
      referenceStatus.textContent = "Could not use this reference: " + (error?.message || String(error));
    } finally {
      updateControls();
    }
  });

  function addClip(blob, label) {
    clipNumber += 1;
    if (clips.querySelector("p")) clips.replaceChildren();
    const url = URL.createObjectURL(blob);
    const card = document.createElement("div");
    card.className = "clip";
    const title = document.createElement("strong");
    title.textContent = "Clip " + clipNumber + " · " + label;
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = url;
    const download = document.createElement("a");
    download.href = url;
    download.download = "browser-voice-clone-" + String(clipNumber).padStart(3, "0") + ".wav";
    download.textContent = "Download WAV";
    card.append(title, audio, download);
    clips.prepend(card);
  }

  async function synthesize() {
    const text = textInput.value.trim();
    if (!tts || !referenceFile || !text || synthesizing) return;
    synthesizing = true;
    updateControls();
    setSynthesisStatus("Synthesizing on WebGPU. Longer text may take a while…");
    try {
      const audio = await tts.speak(text);
      const blob = audio.toBlob();
      addClip(blob, text.length > 64 ? text.slice(0, 61) + "…" : text);
      stopAudioButton.disabled = false;
      setSynthesisStatus("Speech generated locally. Play it here or download the WAV.");
      const latest = clips.querySelector("audio");
      if (latest) {
        if (activeAudio) { try { activeAudio.pause(); } catch {} }
        activeAudio = latest;
        await latest.play().catch(() => {});
      }
    } catch (error) {
      setSynthesisStatus("Synthesis failed: " + (error?.message || String(error)));
    } finally {
      synthesizing = false;
      updateControls();
    }
  }

  function resampleLinear(input, sourceRate, targetRate) {
    if (sourceRate === targetRate) return input;
    const outputLength = Math.max(1, Math.round(input.length * targetRate / sourceRate));
    const output = new Float32Array(outputLength);
    const ratio = sourceRate / targetRate;
    for (let i = 0; i < outputLength; i++) {
      const position = i * ratio;
      const left = Math.min(input.length - 1, Math.floor(position));
      const right = Math.min(input.length - 1, left + 1);
      const fraction = position - left;
      output[i] = input[left] * (1 - fraction) + input[right] * fraction;
    }
    return output;
  }

  async function getLocalAsr() {
    if (asr) return asr;
    if (!navigator.gpu || !(await navigator.gpu.requestAdapter())) throw new Error("WebGPU is required for local dictation.");
    dictationStatus.textContent = "Loading local Whisper model…";
    asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny.en", {
      device: "webgpu",
      dtype: "q4",
      progress_callback: (event) => {
        if (event?.status === "progress" && Number.isFinite(event.progress)) {
          dictationStatus.textContent = "Downloading local dictation model " + Math.round(event.progress) + "%";
        } else if (event?.status === "done") {
          dictationStatus.textContent = "Preparing local dictation model…";
        }
      },
    });
    return asr;
  }

  async function startDictation() {
    if (mediaRecorder) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setSynthesisStatus("This browser does not support microphone recording.");
      return;
    }
    recordedChunks = [];
    try {
      await getLocalAsr();
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const options = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : undefined;
      mediaRecorder = new MediaRecorder(micStream, options);
      mediaRecorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) recordedChunks.push(event.data);
      });
      mediaRecorder.addEventListener("stop", transcribeRecording, { once: true });
      mediaRecorder.start();
      dictationStatus.textContent = "Recording · local";
      dictateButton.disabled = true;
      stopDictationButton.disabled = false;
    } catch (error) {
      stopMicTracks();
      mediaRecorder = null;
      dictationStatus.textContent = "Mic off";
      setSynthesisStatus("Could not start local dictation: " + (error?.message || String(error)));
      updateControls();
    }
  }

  function stopMicTracks() {
    if (micStream) micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }

  async function transcribeRecording() {
    const recorder = mediaRecorder;
    mediaRecorder = null;
    stopMicTracks();
    stopDictationButton.disabled = true;
    dictationStatus.textContent = "Transcribing locally…";
    try {
      if (!recordedChunks.length) throw new Error("No microphone audio was captured.");
      const blob = new Blob(recordedChunks, { type: recordedChunks[0]?.type || "audio/webm" });
      recordedChunks = [];
      const decodeContext = new AudioContext();
      try {
        const decoded = await decodeContext.decodeAudioData(await blob.arrayBuffer());
        const mono = decoded.getChannelData(0);
        const samples = resampleLinear(mono, decoded.sampleRate, 16000);
        const result = await asr({ audio: samples, sampling_rate: 16000 });
        const transcript = (result?.text || "").trim();
        if (!transcript) throw new Error("No speech was recognized. Try speaking a little longer or closer to the microphone.");
        const existing = textInput.value.trim();
        textInput.value = existing ? existing + " " + transcript : transcript;
        textInput.dispatchEvent(new Event("input", { bubbles: true }));
        dictationStatus.textContent = "Dictation added";
        setSynthesisStatus("Dictation completed on-device. Review the text, then synthesize.");
      } finally {
        await decodeContext.close();
      }
    } catch (error) {
      dictationStatus.textContent = "Dictation failed";
      setSynthesisStatus("Local dictation failed: " + (error?.message || String(error)));
    } finally {
      updateControls();
    }
  }

  function stopDictation() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      dictationStatus.textContent = "Finishing recording…";
      mediaRecorder.stop();
    }
    stopDictationButton.disabled = true;
  }

  textInput.addEventListener("input", updateControls);
  loadButton.addEventListener("click", loadModels);
  synthesizeButton.addEventListener("click", synthesize);
  dictateButton.addEventListener("click", startDictation);
  stopDictationButton.addEventListener("click", stopDictation);
  stopAudioButton.disabled = true;
  stopAudioButton.addEventListener("click", () => {
    if (activeAudio) { activeAudio.pause(); activeAudio.currentTime = 0; }
    stopAudioButton.disabled = true;
  });
  $("#clear").addEventListener("click", () => {
    for (const audio of clips.querySelectorAll("audio")) {
      audio.pause();
      if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
    }
    clips.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Generated audio will appear here.", className: "muted" }));
    clipNumber = 0;
  });
  window.addEventListener("beforeunload", () => {
    stopMicTracks();
    if (tts) void tts.dispose();
    if (activeAudio) activeAudio.pause();
  });
  stopDictationButton.textContent = stopDictationButtonInitialText;
  updateControls();
})();