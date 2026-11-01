# Pocket TTS Studio → PocketWebTools bridge

This Chrome extension connects the GitHub Pages transcription app to the PocketWebTools Voice Cloning page.

## Install
1. Download the repository ZIP from GitHub and extract it.
2. In desktop Chrome, open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `extension/pocketweb-dictation` folder.
4. Open [PocketWebTools Voice Cloning](https://pocketweb.tools/voice-cloning) in one tab.
5. Open [Pocket TTS Studio](https://nezoko45-dev.github.io/voicechanger/pocket-tts-studio/) in another tab. Reload both tabs after installing the extension.
6. In PocketWebTools, upload your reference WAV using its own reference-audio control.
7. On Pocket TTS Studio, choose your microphone language if needed and press **Start listening**.

## What happens
- Pocket TTS Studio uses Chrome's Web Speech Recognition to transcribe your microphone.
- After a short pause in speech, it sends the recognized phrase through the extension bridge.
- The extension finds the open PocketWebTools Voice Cloning tab and inserts the phrase into its TTS text field.
- You press **Generate Speech** on PocketWebTools when ready.

## Important
- The extension is required: normal web pages cannot directly edit fields on another website because of browser origin isolation.
- The page sends transcript text only. It does not transfer the reference WAV, click Generate Speech, or play the result.
- Keep both tabs open. If you install/update the extension, reload both tabs.
- Desktop Chrome is recommended. Chrome speech recognition availability depends on microphone permission, language and the browser's speech service.
- Only clone voices you own or have permission to use.
