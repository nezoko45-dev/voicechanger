(() => {
  const button = document.querySelector("#toggle");
  const status = document.querySelector("#status");

  function render(result) {
    const active = !!result?.automatic;
    button.textContent = active ? "■ Stop automatic clicking" : "▶ Start automatic clicking";
    button.classList.toggle("stop", active);
    status.textContent = result?.message || "Ready.";
  }

  async function send(type) {
    button.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ type });
      render(result);
    } catch (error) {
      status.textContent = "Action failed: " + (error?.message || String(error));
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener("click", () => send("FISH_AUDIO_AUTO_TOGGLE"));
  send("FISH_AUDIO_GET_STATUS");
})();
