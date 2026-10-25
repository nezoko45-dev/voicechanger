# Character.AI Voice Dictation (Chrome Extension)

A Manifest V3 Chrome extension that uses Chrome's **on-device speech recognition** to dictate into the Character.AI chat composer. Speech transcription is configured to run locally, not through a remote speech-recognition service.

## Behavior
- Click the extension icon and choose **Start dictation**.
- On first use, Chrome may need to download the offline language pack. This initial download requires an internet connection.
- After the language pack is installed, recognition can work offline on this computer.
- Each new dictated message starts with the single word `repeat`. For example, saying “Hello there” inserts `repeat Hello there`.
- The extension automatically clicks the Send button after approximately 1.2 seconds without recognized speech.
- Click **Stop dictation** to stop listening.
- If Chrome ends a recognition session, the extension attempts to restart it.

## Install in Chrome
1. Download or clone this repository and locate the `cai-dictation` folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the `cai-dictation` folder.
5. If the extension is already installed, click its **Reload** button after updating the files.
6. Open a Character.AI chat, allow microphone access if prompted, and click the extension icon.

## Important notes
- Use a recent Chrome version that supports the Web Speech API's on-device recognition (`processLocally`, `available()`, and `install()`). The extension checks support before starting.
- Chrome downloads and stores the language pack locally. The first installation needs internet; later transcription should be offline while the pack remains installed.
- “Stays forever” cannot be guaranteed: Chrome may stop sessions, restart the browser, or require renewed microphone permission. The extension automatically restarts recognition sessions while the tab remains active, but it does not bypass browser or operating-system limits.
- Automatic sending means recognized text is sent without a review step; check that the transcript is correct if accuracy matters.
- Character.AI can change its page structure. If the extension cannot find the composer or Send button, refresh the chat and try again.
