(() => {
  const button = document.querySelector("#call-again");
  const status = document.querySelector("#status");

  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Looking for “Call again”…";
    try {
      const result = await chrome.runtime.sendMessage({ type: "FISH_AUDIO_CLICK_AGAIN" });
      status.textContent = result?.message || (result?.ok ? "Clicked “Call again”." : "Could not click the button.");
    } catch (error) {
      status.textContent = "Click failed: " + (error?.message || String(error));
    } finally {
      button.disabled = false;
    }
  });
})();
