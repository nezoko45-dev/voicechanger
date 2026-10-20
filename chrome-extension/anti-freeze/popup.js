const list = document.getElementById("tabs-list");
const status = document.getElementById("status");
const form = document.getElementById("add-form");
const urlInput = document.getElementById("tab-url");

function send(message) {
  return new Promise(resolve => chrome.runtime.sendMessage(message, resolve));
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? "#ff9b9b" : "#b7c0d3";
}

async function refreshTabs() {
  const response = await send({ type: "GET_TABS" });
  list.replaceChildren();
  const tabs = (response?.tabs || []).filter(tab => tab.url && /^https?:/.test(tab.url));
  if (!tabs.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No regular web tabs found.";
    list.append(empty);
    return;
  }
  tabs.sort((a, b) => Number(b.protected) - Number(a.protected) || Number(b.active) - Number(a.active));
  for (const tab of tabs) {
    const item = document.createElement("li");
    item.className = "tab";
    const info = document.createElement("div");
    info.className = "tab-info";
    const title = document.createElement("div");
    title.className = "tab-title";
    title.textContent = tab.title;
    const url = document.createElement("div");
    url.className = "tab-url";
    url.textContent = tab.url;
    const pill = document.createElement("span");
    pill.className = "pill" + (tab.protected ? "" : " off");
    pill.textContent = tab.protected ? "Protected from discard" : "Not protected";
    info.append(title, url, pill);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tab.protected ? "Unprotect" : "Protect";
    button.addEventListener("click", async () => {
      button.disabled = true;
      const result = await send({ type: tab.protected ? "UNPROTECT_TAB" : "PROTECT_TAB", tabId: tab.id });
      setStatus(result?.success ? "Tab setting updated." : "Could not update this tab.", !result?.success);
      await refreshTabs();
    });
    item.append(info, button);
    list.append(item);
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const url = urlInput.value.trim();
  setStatus("Adding tab…");
  const result = await send({ type: "ADD_TAB", url });
  if (result?.success) {
    urlInput.value = "";
    setStatus("Tab added and marked non-discardable.");
    await refreshTabs();
  } else {
    setStatus(result?.error || "Could not add that tab.", true);
  }
});

document.getElementById("refresh").addEventListener("click", refreshTabs);
refreshTabs().catch(() => setStatus("Could not load tabs. Try reopening the popup.", true));
