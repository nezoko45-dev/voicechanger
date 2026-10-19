const checkbox = document.querySelector("#auto");
chrome.storage.local.get(["autoGenerate"], data => {
  if (typeof data.autoGenerate === "boolean") checkbox.checked = data.autoGenerate;
});
checkbox.addEventListener("change", () => chrome.storage.local.set({autoGenerate: checkbox.checked}));