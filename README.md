# VoiceChanger PocketWeb Dictation

This Chrome extension uses the browser's built-in Web Speech recognition (`SpeechRecognition` / `webkitSpeechRecognition`) to dictate sentences into PocketWebTools. **No Python, local server, or separate transcription engine is required.**

## Use it

1. Open `chrome://extensions`, enable Developer mode, and click **Load unpacked**.
2. Select the folder containing this branch's root `manifest.json`, `content.js`, `popup.html`, and `popup.js`.
3. Open [PocketWebTools Voice Cloning](https://pocketweb.tools/voice-cloning).
4. Click the extension icon and choose **Start listening**. Allow microphone access if Chrome prompts you.
5. Speak naturally. After 2.5 seconds of silence, the extension submits the recognized sentence, clicks Generate, plays the generated result, and resumes listening. Use **Stop** to end the loop.

## Notes

- Uses the speech recognition service provided by your browser/platform; availability and recognition behavior depend on Chrome and its configured speech service.
- Desktop Chrome is recommended. If recognition is unavailable or permission is denied, check the site's microphone permission and browser/platform speech settings.
- The result Play-button selection is heuristic and may need adjustment if PocketWebTools changes its page markup.
- Use only a voice you own or have permission to clone.
