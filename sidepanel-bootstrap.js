(() => {
  const panelScript = document.querySelector('script[data-panel-app]');
  const diagnostic = document.querySelector("#diagnostic");
  if (!panelScript || !diagnostic) return;
  panelScript.addEventListener("error", () => {
    diagnostic.style.display = "block";
    diagnostic.textContent = "Could not load sidepanel.js. Reload the extension at chrome://extensions or reinstall the extracted branch folder.";
  });
})();
