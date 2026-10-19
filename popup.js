document.querySelector("#open-panel").addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({active:true,lastFocusedWindow:true});
  const tab = tabs[0];
  if (!tab || typeof tab.windowId !== "number") return;
  try {
    await chrome.sidePanel.open({windowId:tab.windowId});
    window.close();
  } catch (error) {
    console.error("Could not open dictation side panel", error);
  }
});