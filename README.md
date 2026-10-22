# PocketWebTools Continuous Voice Dictation

This repository's Chrome extension is the PocketWebTools helper in [`extension/pocketweb-dictation`](extension/pocketweb-dictation/). The legacy VoiceCloneNX extension and its root-level manifest/UI files have been removed from this branch.

The helper listens to speech, waits for a pause, inserts the recognized sentence into [PocketWebTools Voice Cloning](https://pocketweb.tools/voice-cloning), clicks **Generate Speech**, attempts to play the newly generated result, and resumes listening.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/pocketweb-dictation` folder.
4. Open [PocketWebTools Voice Cloning](https://pocketweb.tools/voice-cloning).
5. Click the extension icon and choose **Start listening**. Choose **Stop** to end the loop.

Requires desktop Chrome/Chromium with Web Speech recognition support. Browser speech recognition availability may vary. The generated-result Play button detection is heuristic and may need adjustment if PocketWebTools changes its page markup.

See the [helper README](extension/pocketweb-dictation/README.md) for more details.
