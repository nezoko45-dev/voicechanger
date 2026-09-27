import { VoxShot, ChatterboxEngine } from "https://esm.sh/voxshot@latest";

const $ = id => document.getElementById(id);
let tts = null, recorder = null, chunks = [], referenceBlob = null, playing = null;
let lastProgress = -1;

function status(s){ $("status").textContent = s; }
function log(s){ $("log").textContent = s; }

function showProgress(show){
  $("progressBox").style.display = show ? "block" : "none";
}

function setProgress(value, label = "Loading model"){
  const n = Number(value);
  if(!Number.isFinite(n)) return;

  // VoxShot progress should be 0..1, but protect the UI from malformed events.
  const pct = Math.max(0, Math.min(100, n <= 1 ? n * 100 : n));
  const rounded = Math.round(pct);

  // Never let the displayed percentage jump backward because of noisy events.
  if(rounded < lastProgress) return;
  lastProgress = rounded;

  $("progressLabel").textContent = label;
  $("progressPercent").textContent = rounded + "%";
  $("progressBar").style.width = rounded + "%";
}

function resetProgress(label = "Loading model"){
  lastProgress = -1;
  showProgress(true);
  setProgress(0, label);
}

function finishProgress(label = "Model ready"){
  lastProgress = 100;
  $("progressLabel").textContent = label;
  $("progressPercent").textContent = "100%";
  $("progressBar").style.width = "100%";
}

async function load(){
  if(tts) return tts;

  $("startBtn").disabled = true;
  resetProgress("Loading VoxShot");

  try{
    const engine = new ChatterboxEngine({
      onProgress: p => {
        if(!p) return;

        if(p.status === "progress"){
          setProgress(p.progress, "Loading model");
        }else if(p.status === "load-start"){
          $("progressLabel").textContent = "Starting " + (p.plan || "WebGPU");
          status("Loading VoxShot model...");
        }else if(p.status === "load-fallback"){
          $("progressLabel").textContent = "Trying fallback";
          status("WebGPU fallback: " + (p.reason || "trying next backend"));
        }else if(p.status === "load-ready"){
          finishProgress("Model ready");
          status("VoxShot model ready: " + (p.plan || "local"));
        }
      }
    });

    tts = await VoxShot.create({
      engine,
      device: "auto",
      minChunkLength: 20
    });

    finishProgress("Model ready");
    status("VoxShot model ready");
    $("startBtn").disabled = false;
    $("cloneBtn").disabled = !referenceBlob;
    log("VoxShot backend: " + (tts.device || "auto"));
    return tts;
  }catch(e){
    showProgress(true);
    $("progressLabel").textContent = "Load failed";
    status("VoxShot failed to load.");
    log(e?.message || String(e));
    $("startBtn").disabled = false;
    throw e;
  }
}

$("startBtn").onclick = () => load().catch(() => {});

$("recordBtn").onclick = async()=>{
  if(recorder?.state === "recording"){
    recorder.stop();
    $("recordBtn").textContent = "🎙 Record 5–15 sec";
    return;
  }

  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    chunks = [];
    recorder = new MediaRecorder(stream);

    recorder.ondataavailable = e => {
      if(e.data.size) chunks.push(e.data);
    };

    recorder.onstop = ()=>{
      referenceBlob = new Blob(chunks, {type: recorder.mimeType || "audio/webm"});
      stream.getTracks().forEach(t => t.stop());
      $("referenceInfo").textContent = "Reference recorded.";
      $("cloneBtn").disabled = false;
    };

    recorder.start();
    $("recordBtn").textContent = "⏹ Stop recording";
    $("referenceInfo").textContent = "Recording — speak naturally for 5–15 seconds.";
  }catch(e){
    status("Microphone permission failed.");
    log(e?.message || String(e));
  }
};

$("fileInput").onchange = ()=>{
  const f = $("fileInput").files?.[0];
  if(f){
    referenceBlob = f;
    $("referenceInfo").textContent = "Reference: " + f.name;
    $("cloneBtn").disabled = false;
  }
};

$("cloneBtn").onclick = async()=>{
  try{
    const v = await load();
    status("Cloning reference voice...");
    await v.cloneVoice(referenceBlob);
    status("Voice cloned!");
    $("speakBtn").disabled = false;
    log("Voice embedding cached locally.");
  }catch(e){
    console.error(e);
    status("Clone failed — open Chrome DevTools for details.");
    log(e?.message || String(e));
  }
};

$("speakBtn").onclick = async()=>{
  const text = $("text").value.trim();
  if(!text || !tts) return;

  try{
    if(playing) await playing.stop();
    status("Speaking...");
    playing = tts.play(text, {speed:+$("speed").value, volume:1});
    await playing.done;
    status("Ready");
  }catch(e){
    console.error(e);
    status("Playback failed.");
    log(e?.message || String(e));
  }finally{
    playing = null;
  }
};

$("stopBtn").onclick = async()=>{
  if(playing) await playing.stop();
  playing = null;
  status(tts ? "Ready" : "Not loaded");
};