import { VoxShot, ChatterboxEngine } from "https://esm.sh/voxshot@latest?deps=@huggingface/transformers";

const $ = id => document.getElementById(id);
let tts = null;
let referenceFile = null;
let recording = null;
let chunks = [];
let currentSpeech = null;

function status(text){ $("status").textContent = text; }
function log(text){ $("log").textContent = text; }

function progress(show, value = 0, label = "Loading model"){
  $("progressBox").style.display = show ? "block" : "none";
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  $("progressBar").style.width = pct + "%";
  $("progressPercent").textContent = pct + "%";
  $("progressLabel").textContent = label;
}

async function loadVoxShot(){
  if(tts) return tts;

  $("startBtn").disabled = true;
  progress(true, 0, "Checking WebGPU");
  status("Checking Chrome WebGPU...");
  if(!navigator.gpu){
    status("WebGPU is unavailable in this Chrome session.");
    log("Open Chrome with hardware acceleration enabled, then reload.");
    $("startBtn").disabled = false;
    return null;
  }
  try{
    const adapter = await navigator.gpu.requestAdapter();
    if(!adapter){ throw new Error("Chrome could not access a WebGPU adapter."); }
    log("WebGPU detected. Loading Chatterbox q4...");
  }catch(error){
    status("WebGPU check failed.");
    log(error?.message || String(error));
    $("startBtn").disabled = false;
    return null;
  }
  progress(true, 0, "Starting Chatterbox");
  status("Starting Chatterbox...");

  try{
    const engine = new ChatterboxEngine({
      stallTimeoutMs: 120000,
      requiresGpu: true,
      dtype: "q4",
      onProgress: p => {
        if(!p) return;

        if(p.status === "load-start"){ status("Loading " + (p.plan || "Chatterbox") + "..."); }
        else if(p.status === "load-compiling"){ progress(true, 100, "Compiling ONNX model"); status("Compiling ONNX model — Chrome may be busy for a while..."); }
        else if(p.status === "load-fallback"){ status("GPU plan failed; " + (p.reason || "load fallback")); }
        else if(p.status === "progress"){
          const pct = Number(p.progress);
          progress(true, pct <= 1 ? pct * 100 : pct, "Downloading model");
          status("Downloading VoxShot model...");
        }else{
          const label = String(p.status || "Loading").replaceAll("-", " ");
          $("progressLabel").textContent = label;
          if(p.status === "load-ready"){
            progress(true, 100, "Model ready");
            status("VoxShot is ready.");
          }
        }
      }
    });

    tts = await VoxShot.create({
      engine,
      device: "webgpu",
      minChunkLength: 20
    });

    progress(true, 100, "Model ready");
    status("VoxShot is ready.");
    log("Backend: " + (tts.device || "auto"));
    $("startBtn").textContent = "✓ VoxShot Loaded";
    $("cloneBtn").disabled = !referenceFile;
    return tts;
  }catch(error){
    progress(true, 0, "Load failed");
    status("VoxShot failed to load.");
    log(error?.message || String(error));
    $("startBtn").disabled = false;
    throw error;
  }
}

$("startBtn").onclick = () => loadVoxShot().catch(() => {});

// The batch launcher opens this page directly, so start VoxShot automatically.
window.addEventListener("load", () => {
  setTimeout(() => loadVoxShot().catch(() => {}), 300);
});

$("fileInput").onchange = event => {
  const file = event.target.files?.[0];
  if(!file) return;
  referenceFile = file;
  $("referenceInfo").textContent = "Reference: " + file.name;
  $("cloneBtn").disabled = false;
};

$("recordBtn").onclick = async()=>{
  if(recording?.state === "recording"){
    recording.stop();
    $("recordBtn").textContent = "🎙 Record 5–15 sec";
    return;
  }

  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    chunks = [];
    recording = new MediaRecorder(stream);

    recording.ondataavailable = event => {
      if(event.data.size) chunks.push(event.data);
    };

    recording.onstop = ()=>{
      referenceFile = new File(
        [new Blob(chunks, {type: recording.mimeType || "audio/webm"})],
        "microphone-reference.webm",
        {type: recording.mimeType || "audio/webm"}
      );
      stream.getTracks().forEach(track => track.stop());
      $("referenceInfo").textContent = "Microphone reference recorded.";
      $("cloneBtn").disabled = false;
    };

    recording.start();
    $("recordBtn").textContent = "⏹ Stop recording";
    $("referenceInfo").textContent = "Recording — speak naturally for 5–15 seconds.";
  }catch(error){
    status("Microphone permission failed.");
    log(error?.message || String(error));
  }
};

$("cloneBtn").onclick = async()=>{
  if(!referenceFile) return;

  try{
    const v = await loadVoxShot();
    status("Cloning voice...");
    await v.cloneVoice(referenceFile);
    status("Voice cloned! Ready to speak.");
    log("Voice clone is ready.");
    $("speakBtn").disabled = false;
  }catch(error){
    status("Voice cloning failed.");
    log(error?.message || String(error));
  }
};

$("speakBtn").onclick = async()=>{
  const text = $("text").value.trim();
  if(!text || !tts) return;

  try{
    if(currentSpeech) await currentSpeech.stop?.();

    status("Generating speech...");
    const audio = await tts.speak(text);
    status("Playing...");
    currentSpeech = audio;
    await audio.play();
    status("Ready.");
  }catch(error){
    status("Speech failed.");
    log(error?.message || String(error));
  }finally{
    currentSpeech = null;
  }
};

$("stopBtn").onclick = async()=>{
  if(currentSpeech?.stop) await currentSpeech.stop();
  currentSpeech = null;
  status(tts ? "Ready." : "Not loaded.");
};