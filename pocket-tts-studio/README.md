# Pocket TTS Studio

A GitHub Pages companion workspace for Chrome speech recognition and PocketWebTools voice cloning.

## What it does
- Lets you choose and preview a custom WAV reference recording.
- Includes a Chrome Web Speech Recognition test panel with live transcript and copy.
- Links to PocketWebTools Voice Cloning and the repository's companion extension.
- The companion extension performs the automatic loop on PocketWebTools: recognize speech, wait for a pause, fill the text field, click Generate Speech, play the generated result, then resume recognition.

## Important browser boundary
GitHub Pages cannot directly read or click controls inside another site's page because of browser same-origin protections. The reference WAV preview on this page does not upload the file to PocketWebTools. Upload the same WAV in PocketWebTools itself, then use the extension on that tab for the automatic generation/playback loop.

## Publish
Publish the repository's GitHub Pages site from the branch/folder containing this page, or merge this branch into the branch currently used by Pages. The page path is `/pocket-tts-studio/`.

## Extension setup
1. Open `chrome://extensions` and enable Developer mode.
2. Click **Load unpacked** and select `extension/pocketweb-dictation`.
3. Open https://pocketweb.tools/voice-cloning and upload your reference WAV there.
4. Open the extension popup and choose **Start listening**.
5. Stop from the extension popup when finished.

Use only reference voices you own or have permission to use.
