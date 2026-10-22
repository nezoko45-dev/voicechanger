# PocketWebTools continuous voice dictation

This is a separate Chrome extension helper for https://pocketweb.tools/voice-cloning. It complements the main VoiceChanger extension; it does not replace the local voiceclonnx app.

## Install
1. Open the repository folder on your computer (or download this repository as a ZIP from GitHub).
2. In Chrome, open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the `extension/pocketweb-dictation` folder.
4. Open https://pocketweb.tools/voice-cloning and allow microphone access if prompted.
5. Click the extension icon and choose **Start listening**.

## How it works
- Uses the browser's built-in Web Speech recognition to transcribe your speech.
- After roughly 1.8 seconds of silence following a recognized phrase, puts that phrase in the page's text box and clicks **Generate Speech**.
- Waits for an audio/video player to appear, attempts playback, and resumes listening after playback ends.
- Click **Stop** in the extension popup to stop the loop.

## Notes and limitations
- Designed for desktop Chrome/Chromium; mobile browsers may not support extension installation or speech recognition.
- Keep the PocketWebTools tab open and in the foreground while using it.
- Website controls can change. If the helper cannot find the text field, Generate Speech button, or generated audio player, it will show a status message.
- Browser speech recognition availability and accuracy depend on Chrome, language settings, network, and microphone permissions.
- Autoplay may be blocked by the browser. If so, press Play on the page and then stop/restart the helper as needed.
- The helper pauses recognition while generating and playing audio to avoid transcribing the generated voice back into the next phrase.
- Use voice cloning only for your own voice or a voice you have permission to use.
