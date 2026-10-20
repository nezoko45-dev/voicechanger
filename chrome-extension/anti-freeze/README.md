# Anti-Freeze Tabs (Chrome extension)

A small Manifest V3 extension that lets you add a URL as a background tab and mark selected tabs as **not automatically discardable**. It also lets you toggle that setting for existing tabs.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `chrome-extension/anti-freeze` folder from this repository.
5. Open the extension popup, enter a full URL such as `https://vrchat.com`, and click **Add**. You can also protect existing tabs from the list.

## Important limitation

Chrome's `autoDiscardable: false` setting asks Chrome not to automatically discard a tab to reclaim memory. It does **not** disable background timer throttling, operating-system resource pressure, browser crashes, or the target website's own suspension behavior. It cannot guarantee that VRChat or another real-time web app continues running at full speed when another tab is focused. Native VRChat performance is not controlled by a Chrome extension.

The extension only uses the `tabs` and `storage` permissions. It does not read page contents or inject scripts into websites.
