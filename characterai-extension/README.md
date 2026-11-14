# Character.AI Voice Keepalive Extension

## Install
1. Download this folder (or ZIP it) from the repository.
2. Open Chrome: `chrome://extensions`
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select `characterai-extension`.
5. Open Character.AI and use the extension popup to enable keep-alive.

## Behavior
- Runs in Character.AI tabs, including background tabs (Chrome may throttle timers in inactive tabs).
- Clicks the accessible Voice button every 5 seconds.
- Pauses while Character.AI exposes a generation/Stop control.
- Can pause promptly when the dictation page sends `CAI_USER_SPEAKING` via window.postMessage.

Note: Chrome can throttle inactive-tab timers; exact 5-second cadence isn't guaranteed while backgrounded. The Voice button must be present and enabled in the page DOM.