import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
const $ = (id) => document.getElementById(id);
const startBtn = $("startBtn");
const stopBtn = $("stopBtn");
const status = $("status");
const modelStatus = $("modelStatus");
const hint = $("hint");
const input = $("messageInput");
const sendBtn = $("sendBtn");
const form = $("chatForm");
const messagesEl = $("messages");
const turnCount = $("turnCount");
const orb = $("orb");
const meterFill = $("meterFill");

let generator = null;
let loadingPromise = null;
let sessionActive = false;
let busy = false;
let turns = 0;
const history = [{ role: "system", content: "You are a friendly, concise voice-call AI assistant. Speak naturally, use short responses, and ask one question at a time when useful." }];

env.allowLocalModels = false;
env.useBrowserCache = true;

function setStatus(text, mode = "") {
  status.textContent = text;
  orb.classList.toggle("active", mode === "active");
  orb.classList.toggle("thinking", mode === "thinking");
}
function addMessage(role, content) {
  $("emptyState")?.remove();
  const node = document.createElement("div");
  node.className = `message ${role}`;
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = role === "user" ? "You" : "Agent";
  const body = document.createElement("div");
  body.textContent = content;
  node.append(label, body);
  messagesEl.append(node);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function setBusy(value) {
  busy = value;
  sendBtn.disabled = value || !sessionActive;
  input.disabled = value || !sessionActive;
  startBtn.disabled = value || sessionActive;
  stopBtn.disabled = value || !sessionActive;
  meterFill.style.width = value ? "72%" : (sessionActive ? "28%" : "0%");
}
async function loadModel() {
  if (generator) return generator;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    modelStatus.textContent = "Downloading model · first run may take a while…";
    hint.textContent = "Model weights are downloaded from Hugging Face and cached by your browser. No API key is used.";
    setStatus("Preparing your local AI", "thinking");
    try {
      const device = navigator.gpu ? "webgpu" : "wasm";
      modelStatus.textContent = `Loading ${MODEL_ID} · ${device.toUpperCase()}`;
      generator = await pipeline("text-generation", MODEL_ID, {
        device,
        dtype: device === "webgpu" ? "q4" : "q4",
        progress_callback: (progress) => {
          if (progress?.status === "progress" && Number.isFinite(progress.progress)) {
            modelStatus.textContent = `Downloading model · ${Math.round(progress.progress)}%`;
          } else if (progress?.status) {
            modelStatus.textContent = `Model: ${progress.status}`;
          }
        }
      });
      modelStatus.textContent = `Local model ready · ${device.toUpperCase()}`;
      hint.textContent = "Your chat prompts and generated replies are processed in this browser. The initial model download requires an internet connection.";
      return generator;
    } catch (error) {
      generator = null;
      modelStatus.textContent = "Model failed to load";
      hint.textContent = `Could not load the model: ${error.message}. Try Chrome or Edge with WebGPU enabled, or reload to retry.`;
      throw error;
    } finally {
      loadingPromise = null;
    }
  })();
  return loadingPromise;
}
async function startSession() {
  sessionActive = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus("Warming up the local model", "thinking");
  try {
    await loadModel();
    input.disabled = false;
    sendBtn.disabled = false;
    setStatus("Connected · your turn", "active");
    input.focus();
  } catch {
    sessionActive = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    setStatus("Couldn't start — check the model status");
  }
}
function endSession() {
  sessionActive = false;
  setBusy(false);
  startBtn.disabled = false;
  stopBtn.disabled = true;
  input.disabled = true;
  sendBtn.disabled = true;
  setStatus("Session ended");
  modelStatus.textContent = generator ? "Local model ready · cached in this page" : "AI model not loaded";
}
async function sendMessage(text) {
  const prompt = text.trim();
  if (!prompt || busy || !sessionActive) return;
  addMessage("user", prompt);
  history.push({ role: "user", content: prompt });
  input.value = "";
  setBusy(true);
  setStatus("Thinking locally…", "thinking");
  try {
    const model = await loadModel();
    const output = await model(history, {
      max_new_tokens: 160,
      do_sample: true,
      temperature: 0.7,
      top_p: 0.9,
      repetition_penalty: 1.08,
      return_full_text: false
    });
    const answer = output?.[0]?.generated_text?.trim() || "Sorry, I couldn't form a reply. Try asking another way.";
    history.push({ role: "assistant", content: answer });
    addMessage("assistant", answer);
    turns += 1;
    turnCount.textContent = `${turns} ${turns === 1 ? "turn" : "turns"}`;
    setStatus("Connected · your turn", "active");
  } catch (error) {
    const message = `I hit a model error: ${error.message}`;
    addMessage("assistant", message);
    history.pop();
    setStatus("Model error · try again");
  } finally {
    setBusy(false);
    if (sessionActive) {
      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }
}
startBtn.addEventListener("click", startSession);
stopBtn.addEventListener("click", endSession);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});
