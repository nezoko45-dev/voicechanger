const $ = id => document.getElementById(id);

let ws = null;
let ctx = null;
let inputStream = null;
let processor = null;
let outputNode = null;
let mediaDestination = null;
let playback = null;
let running = false;
let devicesLoaded = false;

const TARGET_RATE = 24000;

function status(text, good = false, bad = false) {
  const el = $("status");
  el.textContent = text;
  el.className = "status" + (good ? " good" : "") + (bad ? " bad" : "");
}

function b64(buffer) {
  let s = "";
  const a = new Uint8Array(buffer);
  for (let i = 0; i < a.length; i += 0x8000) {
    s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromB64(value) {
  const b = atob(value);
  const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a.buffer;
}

function pcm16ToFloat(buffer) {
  const input = new Int16Array(buffer);
  const output = new Float32Array(input.length);

  for (let i = 0; i < input.length; i++) {
    output[i] = input[i] / 32768;
  }

  return output;
}

function resampleTo24k(input, sourceRate) {
  if (sourceRate === TARGET_RATE) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      out[i] = Math.max(-1, Math.min(1, input[i])) * 32767;
    }
    return out.buffer;
  }

  const ratio = sourceRate / TARGET_RATE;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(length);

  for (let i = 0; i < length; i++) {
    const p = i * ratio;
    const j = Math.floor(p);
    const f = p - j;
    const a = input[Math.min(j, input.length - 1)] || 0;
    const b = input[Math.min(j + 1, input.length - 1)] || a;
    const sample = a * (1 - f) + b * f;
    out[i] = Math.max(-1, Math.min(1, sample)) * 32767;
  }

  return out.buffer;
}

async function makeOutputWorklet() {
  const code = `
    class HFOutput extends AudioWorkletProcessor {
      constructor() {
        super();
        this.q = [];
        this.pos = 0;
        this.port.onmessage = e => {
          if (e.data.kind === "audio") this.q.push(e.data.samples);
          if (e.data.kind === "clear") {
            this.q = [];
            this.pos = 0;
          }
        };
      }

      process(inputs, outputs) {
        const output = outputs[0][0];
        output.fill(0);

        let p = 0;

        while (p < output.length && this.q.length) {
          const chunk = this.q[0];
          const remaining = chunk.length - this.pos;
          const count = Math.min(remaining, output.length - p);

          output.set(chunk.subarray(this.pos, this.pos + count), p);

          p += count;
          this.pos += count;

          if (this.pos >= chunk.length) {
            this.q.shift();
            this.pos = 0;
          }
        }

        return true;
      }
    }

    registerProcessor("hf-output", HFOutput);
  `;

  const blob = new Blob([code], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);

  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadDevices() {
  const permission = await navigator.mediaDevices.getUserMedia({ audio: true });
  permission.getTracks().forEach(track => track.stop());

  const devices = await navigator.mediaDevices.enumerateDevices();

  const oldInput = $("input").value;
  const oldOutput = $("output").value;

  $("input").innerHTML = "";
  $("output").innerHTML = "";

  devices
    .filter(d => d.kind === "audioinput")
    .forEach(d => {
      const option = document.createElement("option");
      option.value = d.deviceId;
      option.textContent = d.label || "Microphone";
      $("input").appendChild(option);
    });

  devices
    .filter(d => d.kind === "audiooutput")
    .forEach(d => {
      const option = document.createElement("option");
      option.value = d.deviceId;
      option.textContent = d.label || "Speaker / Voicemeeter";
      $("output").appendChild(option);
    });

  if ([...$("input").options].some(o => o.value === oldInput)) {
    $("input").value = oldInput;
  }

  if ([...$("output").options].some(o => o.value === oldOutput)) {
    $("output").value = oldOutput;
  }

  devicesLoaded = true;
}

function sendSessionUpdate() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
    type: "session.update",
    session: {
      type: "realtime",
      instructions:
        "REPEAT-ONLY MODE. Repeat the user's spoken words exactly. " +
        "Do not answer. Do not greet. Do not ask questions. " +
        "Do not add, remove, summarize, explain, or paraphrase. " +
        "Output only what the user said.",
      audio: {
        input: {
          format: {
            type: "audio/pcm",
            rate: TARGET_RATE
          },
          turn_detection: {
            type: "server_vad"
          }
        },
        output: {
          format: {
            type: "audio/pcm",
            rate: TARGET_RATE
          },
          voice: $("voice").value
        }
      },
      output_modalities: ["audio"]
    }
  }));
}

async function start() {
  if (running) return;

  try {
    if (!devicesLoaded) await loadDevices();

    const inputId = $("input").value;
    const outputId = $("output").value;

    inputStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: inputId ? { exact: inputId } : undefined,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    ctx = new AudioContext({ sampleRate: TARGET_RATE });
    await ctx.resume();

    await makeOutputWorklet();

    outputNode = new AudioWorkletNode(ctx, "hf-output");

    mediaDestination = ctx.createMediaStreamDestination();
    outputNode.connect(mediaDestination);

    playback = document.createElement("audio");
    playback.autoplay = true;
    playback.playsInline = true;
    playback.srcObject = mediaDestination.stream;
    playback.volume = 1;

    document.body.appendChild(playback);

    if (outputId && typeof playback.setSinkId === "function") {
      try {
        await playback.setSinkId(outputId);
      } catch (err) {
        console.warn("Could not select output device:", err);
      }
    }

    const source = ctx.createMediaStreamSource(inputStream);

    processor = ctx.createScriptProcessor(2048, 1, 1);

    processor.onaudioprocess = event => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const samples = event.inputBuffer.getChannelData(0);
      const pcm = resampleTo24k(samples, ctx.sampleRate);

      ws.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: b64(pcm)
      }));
    };

    const silent = ctx.createGain();
    silent.gain.value = 0;

    source.connect(processor);
    processor.connect(silent);
    silent.connect(ctx.destination);

    ws = new WebSocket("ws://127.0.0.1:8766/v1/realtime");

    ws.onopen = () => {
      sendSessionUpdate();
      running = true;
      status("Connected • listening", true);
    };

    ws.onmessage = event => {
      let message;

      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === "error") {
        status(message.error?.message || "Hugging Face backend error", false, true);
        return;
      }

      if (message.type === "conversation.item.input_audio_transcription.completed") {
        $("heard").textContent = "Heard: " + (message.transcript || "");
      }

      if (
        message.type === "response.output_audio.delta" ||
        message.type === "response.audio.delta"
      ) {
        if (outputNode && message.delta) {
          outputNode.port.postMessage({
            kind: "audio",
            samples: pcm16ToFloat(fromB64(message.delta))
          });
        }
      }

      if (message.type === "input_audio_buffer.speech_started") {
        status("Listening…", true);
      }

      if (message.type === "input_audio_buffer.speech_stopped") {
        status("Repeating…", true);
      }
    };

    ws.onerror = () => {
      status("Local backend connection failed. Keep server.exe running.", false, true);
    };

    ws.onclose = () => {
      if (running) {
        running = false;
        status("Disconnected", false, true);
      }
    };
  } catch (error) {
    status(error.message || String(error), false, true);
    stop();
  }
}

function stop() {
  running = false;

  try { processor?.disconnect(); } catch {}
  try { outputNode?.port.postMessage({ kind: "clear" }); } catch {}
  try { outputNode?.disconnect(); } catch {}
  try { inputStream?.getTracks().forEach(track => track.stop()); } catch {}
  try { ws?.close(); } catch {}
  try { ctx?.close(); } catch {}

  if (playback) {
    playback.pause();
    playback.srcObject = null;
    playback.remove();
  }

  ws = null;
  ctx = null;
  processor = null;
  outputNode = null;
  mediaDestination = null;
  inputStream = null;
  playback = null;

  status("Stopped.", true);
}

$("start").onclick = start;
$("stop").onclick = stop;

$("voice").onchange = () => sendSessionUpdate();

navigator.mediaDevices.addEventListener?.(
  "devicechange",
  () => loadDevices().catch(() => {})
);

loadDevices()
  .then(() => status("Ready — press Start.", true))
  .catch(() => status("Allow microphone access, then press Start.", false, true));
