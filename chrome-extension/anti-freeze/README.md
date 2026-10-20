# Anti-Freeze Tabs (Chrome extension)

A small Manifest V3 extension for protecting selected web tabs from Chrome's **automatic tab discarding**. It can help keep a browser-based tool such as Zolt TTS open while you play the native VRChat desktop app.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `chrome-extension/anti-freeze` folder from this repository.
5. Open Zolt TTS in a Chrome tab, copy its URL, then open this extension and paste the URL into **Add a tab to protect**. You can also use **Protect** beside an already-open tab.

## Important: also change Chrome's performance setting

The extension's protection only addresses automatic tab discarding. Chrome may still throttle JavaScript timers in background tabs, which can make live browser tools pause or respond slowly.

For Zolt TTS, also try:

1. Open Chrome Settings.
2. Go to **Performance**.
3. Under **Always keep these sites active** (wording can vary by Chrome version), add the Zolt TTS website.
4. Keep Zolt TTS open while playing VRChat and test whether it stays responsive.

If the Performance section is not present in your Chrome version, look for the equivalent memory-saver/site-exception setting, if available.

## Limitations

- `autoDiscardable: false` asks Chrome not to automatically discard a tab to reclaim memory. It does **not** disable background timer throttling, operating-system resource pressure, browser crashes, or the website's own suspension behavior.
- Chrome extensions do not provide a supported API to guarantee full-speed execution of a background tab.
- Native VRChat performance is not controlled by this extension.
- The extension uses the `tabs` and `storage` permissions. It does not read page contents or inject scripts into websites.
