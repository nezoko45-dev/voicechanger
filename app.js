const el = id => document.getElementById(id);

async function callApi(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Request failed");
  return data;
}

function show(text, good, bad) {
  const box = el("status");
  box.textContent = text;
  box.className = "status" + (good ? " ok" : "") + (bad ? " bad" : "");
}

async function loadDevices() {
  const data = await callApi("/api/devices");
  const input = el("input");
  const output = el("output");
  input.innerHTML = "";
  output.innerHTML = "";

  data.devices.forEach(device => {
    const label = device.name + " — " + device.hostapi;
    if (device.inputs > 0) {
      const option = document.createElement("option");
      option.value = device.index;
      option.textContent = label;
      input.appendChild(option);
    }
    if (device.outputs > 0) {
      const option = document.createElement("option");
      option.value = device.index;
      option.textContent = label;
      output.appendChild(option);
    }
  });
}

el("ref").addEventListener("change", async () => {
  const file = el("ref").files[0];
  if (!file) return;

  show("Uploading female reference…");
  try {
    await callApi("/api/reference", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: await file.arrayBuffer()
    });
    show("Female reference loaded.", true, false);
  } catch (error) {
    show(error.message, false, true);
  }
});

el("start").addEventListener("click", async () => {
  if (!el("ref").files[0]) {
    show("Choose a female reference first.", false, true);
    return;
  }

  try {
    await callApi("/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input_device: Number(el("input").value),
        output_device: Number(el("output").value),
        steps: Number(el("steps").value),
        cfg: 0.7,
        prompt: 3,
        block_time: 0.25,
        crossfade: 0.04
      })
    });
    show("Voice changer running.", true, false);
  } catch (error) {
    show(error.message, false, true);
  }
});

el("stop").addEventListener("click", async () => {
  try {
    await callApi("/api/stop", { method: "POST" });
    show("Stopped.", true, false);
  } catch (error) {
    show(error.message, false, true);
  }
});

async function poll() {
  try {
    const state = await callApi("/api/status");
    if (state.model === "loading") {
      show("Loading local Hugging Face model…", false, false);
    } else if (state.error) {
      show(state.error, false, true);
    } else if (state.running) {
      show("Running • " + state.inference_ms + " ms inference", true, false);
    } else {
      show("Ready — choose a female reference and press Start.", true, false);
    }
  } catch (error) {
    show("Server is not responding.", false, true);
  }
}

(async function () {
  try { await loadDevices(); } catch (error) {}
  await poll();
  setInterval(poll, 1000);
})();