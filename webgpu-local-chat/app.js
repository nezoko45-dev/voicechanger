import { CreateMLCEngine, prebuiltAppConfig } from "https://esm.run/@mlc-ai/web-llm";

const $ = (id) => document.getElementById(id);
const modelSelect = $("model"), loadButton = $("load"), sendButton = $("send");
const promptBox = $("prompt"), status = $("status"), progress = $("progress"), chat = $("chat");
let engine = null, loading = false, busy = false;
let messages = [{ role: "system", content: "You are a helpful, friendly assistant. Be clear and concise." }];

function setStatus(text) { status.textContent = text; }
function addMessage(role, text) {
  const empty = chat.querySelector(".empty"); if (empty) empty.remove();
  const node = document.createElement("div");
  node.className = "msg " + role;
  node.textContent = text;
  chat.appendChild(node); chat.scrollTop = chat.scrollHeight;
  return node;
}
function supportedModels() {
  const all = prebuiltAppConfig.model_list || [];
  // Keep smaller models in the picker to avoid accidentally selecting a very large download.
  const small = all.filter(m => /0\.5B|1B|1\.5B|2B|3B/i.test(m.model_id));
  return small.length ? small : all.slice(0, 12);
}
const models = supportedModels();
modelSelect.innerHTML = "";
for (const model of models) {
  const option = document.createElement("option");
  option.value = model.model_id;
  option.textContent = model.model_id;
  modelSelect.appendChild(option);
}
modelSelect.disabled = models.length === 0;

if (!("gpu" in navigator)) {
  setStatus("WebGPU is not available in this browser. Update Chrome/Edge and check that hardware acceleration is enabled.");
  loadButton.disabled = true;
} else if (!models.length) {
  setStatus("The model list could not be loaded. Refresh the page and try again.");
} else {
  setStatus("WebGPU API detected. Choose a small model and select Load model.");
}

loadButton.addEventListener("click", async () => {
  if (loading || !modelSelect.value) return;
  loading = true; loadButton.disabled = true; modelSelect.disabled = true;
  progress.hidden = false; progress.value = 0;
  try {
    setStatus("Downloading and preparing model… keep this tab open.");
    engine = await CreateMLCEngine(modelSelect.value, {
      initProgressCallback: (p) => {
        const pct = Math.max(0, Math.min(100, Math.round((p.progress || 0) * 100)));
        progress.value = pct;
        setStatus(p.text || `Loading model… ${pct}%`);
      }
    });
    setStatus("Model ready. Your messages are processed locally.");
    progress.value = 100;
    promptBox.disabled = false; sendButton.disabled = false;
    promptBox.focus();
    loadButton.textContent = "Model loaded";
  } catch (err) {
    console.error(err);
    engine = null;
    setStatus("Model load failed: " + (err?.message || String(err)) + " — try a smaller model or restart the browser.");
    loadButton.disabled = false; modelSelect.disabled = false;
  } finally { loading = false; }
});

async function send() {
  const text = promptBox.value.trim();
  if (!text || !engine || busy) return;
  promptBox.value = ""; busy = true; sendButton.disabled = true;
  messages.push({ role: "user", content: text });
  addMessage("user", text);
  const output = addMessage("assistant", "");
  try {
    const stream = await engine.chat.completions.create({
      messages, stream: true, temperature: 0.7, max_tokens: 700
    });
    let answer = "";
    for await (const chunk of stream) {
      answer += chunk.choices?.[0]?.delta?.content || "";
      output.textContent = answer;
      chat.scrollTop = chat.scrollHeight;
    }
    messages.push({ role: "assistant", content: answer });
    if (!answer) output.textContent = "(The model returned an empty response.)";
  } catch (err) {
    console.error(err);
    output.textContent = "Generation error: " + (err?.message || String(err));
    messages.pop();
  } finally {
    busy = false; sendButton.disabled = false; promptBox.focus();
  }
}
sendButton.addEventListener("click", send);
promptBox.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
$("clear").addEventListener("click", () => {
  messages = [messages[0]];
  chat.innerHTML = '<div class="empty">Chat cleared. Your loaded model is still ready.</div>';
});
