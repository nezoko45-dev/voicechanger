(() => {
  const openPanelButton = document.querySelector("#open-panel");
  const openTabButton = document.querySelector("#open-tab");
  const status = document.querySelector("#status");
  const fallback = document.querySelector("#fallback");

  const setStatus = message => { if (status) status.textContent = message; };

  openTabButton?.addEventListener("click", async () => {
    try {
      await chrome.tabs.create({url: chrome.runtime.getURL("sidepanel.html")});
      setStatus("Opened the panel page in a tab. If this is blank, check chrome://extensions for extension errors.");
    } catch (error) {
      setStatus("Could not open panel page: " + (error?.message || String(error)));
    }
  });

  openPanelButton?.addEventListener("click", async () => {
    openPanelButton.disabled = true;
    setStatus("Opening dictation panel…");
    try {
      if (!chrome.sidePanel?.open) throw new Error("Chrome side panel API is unavailable. Update Chrome to version 116 or newer.");
      const tabs = await chrome.tabs.query({active:true,lastFocusedWindow:true});
      const tab = tabs[0];
      if (!tab || typeof tab.windowId !== "number") throw new Error("Could not find the current Chrome window.");
      await chrome.sidePanel.open({windowId:tab.windowId});
      setStatus("Panel opened. Look along the right side of the Chrome window.");
      window.close();
    } catch (error) {
      setStatus("Could not open the side panel: " + (error?.message || String(error)));
      if (fallback) fallback.style.display = "block";
      openPanelButton.disabled = false;
    }
  });
})();
