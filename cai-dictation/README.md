# Character.AI Voice Dictation (Chrome Extension)

A small Manifest V3 Chrome extension that continuously recognizes microphone speech and inserts finalized phrases into the Character.AI chat composer.

## Behavior
- Click the extension icon and choose **Start dictation**.
- On the first start, it sends this instruction to the selected chat once: “Repeat each word I say exactly as I say it. Do not add commentary, explanations, or extra words. Just repeat my words.”
- Speech recognition then inserts recognized phrases into the message box. Dictated phrases are **not automatically sent**, so you can review them and press Send when ready.
- Click **Stop dictation** to stop listening.
- If Chrome's speech recognition session ends, the extension attempts to restart it.

## Install in Chrome
1. Download or clone this repository and locate the `cai-dictation` folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the `cai-dictation` folder.
5. Open a Character.AI chat, allow microphone access if prompted, and click the extension icon.

## Notes
- This uses Chrome's built-in Web Speech API; recognition availability and processing may depend on Chrome, microphone permissions, and Google's speech service. It is not guaranteed to be fully offline.
- Character.AI can change its page structure. If the extension cannot find the composer or send button, refresh the chat and try again.
- The first-start instruction is sent to the currently open chat. Starting dictation again in the same page does not intentionally send it again.
