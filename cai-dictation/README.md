# Character.AI Voice Dictation (Chrome Extension)

A small Manifest V3 Chrome extension that continuously recognizes microphone speech and inserts finalized speech into the Character.AI chat composer.

## Behavior
- Click the extension icon and choose **Start dictation**.
- Each new dictated message starts with the single word `repeat`. For example, saying “Hello there” inserts `repeat Hello there`.
- The extension automatically clicks the Send button after approximately 1.2 seconds without recognized speech.
- Click **Stop dictation** to stop listening.
- If Chrome's speech recognition session ends, the extension attempts to restart it.

## Install in Chrome
1. Download or clone this repository and locate the `cai-dictation` folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the `cai-dictation` folder.
5. Open a Character.AI chat, allow microphone access if prompted, and click the extension icon.

## Notes
- Automatic sending means recognized text is sent without a review step; check that the transcript is correct if accuracy matters.
- This uses Chrome's built-in Web Speech API; recognition availability and processing may depend on Chrome, microphone permissions, and Google's speech service. It is not guaranteed to be fully offline.
- Character.AI can change its page structure. If the extension cannot find the composer or Send button, refresh the chat and try again.
