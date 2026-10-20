const STORAGE_KEY = "protectedTabIds";

async function getProtectedIds() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}

async function setProtectedIds(ids) {
  await chrome.storage.local.set({ [STORAGE_KEY]: [...new Set(ids)] });
}

async function protectTab(tabId) {
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: false });
    const ids = await getProtectedIds();
    if (!ids.includes(tabId)) {
      ids.push(tabId);
      await setProtectedIds(ids);
    }
    return true;
  } catch (error) {
    console.warn("Could not protect tab", tabId, error);
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "GET_TABS") {
      const tabs = await chrome.tabs.query({});
      const protectedIds = await getProtectedIds();
      sendResponse({ tabs: tabs.map(tab => ({
        id: tab.id,
        title: tab.title || tab.url || "Untitled tab",
        url: tab.url || "",
        active: Boolean(tab.active),
        autoDiscardable: tab.autoDiscardable !== false,
        protected: protectedIds.includes(tab.id) || tab.autoDiscardable === false
      })) });
    } else if (message?.type === "PROTECT_TAB" && Number.isInteger(message.tabId)) {
      sendResponse({ success: await protectTab(message.tabId) });
    } else if (message?.type === "UNPROTECT_TAB" && Number.isInteger(message.tabId)) {
      const ids = (await getProtectedIds()).filter(id => id !== message.tabId);
      await setProtectedIds(ids);
      try {
        await chrome.tabs.update(message.tabId, { autoDiscardable: true });
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: String(error) });
      }
    } else if (message?.type === "ADD_TAB" && typeof message.url === "string") {
      let url;
      try {
        url = new URL(message.url);
      } catch {
        sendResponse({ success: false, error: "Enter a valid URL, such as https://example.com" });
        return;
      }
      if (!["http:", "https:"].includes(url.protocol)) {
        sendResponse({ success: false, error: "Only HTTP and HTTPS tabs are supported." });
        return;
      }
      try {
        const tab = await chrome.tabs.create({ url: url.href, active: false });
        const success = await protectTab(tab.id);
        sendResponse({ success, tabId: tab.id });
      } catch (error) {
        sendResponse({ success: false, error: String(error) });
      }
    }
  })();
  return true;
});

chrome.tabs.onCreated.addListener(async tab => {
  const pending = await chrome.storage.local.get("protectNewTabs");
  if (pending.protectNewTabs && Number.isInteger(tab.id)) await protectTab(tab.id);
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const ids = (await getProtectedIds()).filter(id => id !== tabId);
  await setProtectedIds(ids);
});

// Reapply the preference after Chrome starts, where possible.
chrome.runtime.onStartup.addListener(async () => {
  const ids = await getProtectedIds();
  for (const id of ids) await protectTab(id);
});
