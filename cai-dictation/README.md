# Character.AI Voice Dictation (Chrome Extension)

A small Manifest V3 Chrome extension that continuously recognizes microphone speech and inserts finalized phrases into the Character.AI chat composer.

## Behavior
- Click the extension icon and choose **Start dictation**.
- Every recognized dictation phrase is prefixed with the single word `repeat`. For example, saying “Hello there” inserts `repeat Hello there`.
- The extension does not send messages automatically; review the text and press Send when ready.
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
- Character.AI can change its page structure. If the extension cannot find the composer, refresh the chat and try again.
