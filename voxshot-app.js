import { VoxShot, ChatterboxEngine } from "https://esm.sh/voxshot@latest";

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
  progress(true, 0, "Starting VoxShot");
  status("Starting VoxShot...");

  try{
    const engine = new ChatterboxEngine({
      onProgress: p => {
        if(!p) return;

        if(p.status === "progress"){
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
      device: "auto",
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