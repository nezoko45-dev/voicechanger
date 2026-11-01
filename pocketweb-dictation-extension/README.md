# PocketWeb Dictation Chrome Extension

A Manifest V3 extension for `https://pocketweb.tools/voice-cloning`.

## Install
1. Download this folder (or the repository ZIP) and extract it.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the `pocketweb-dictation-extension` folder.
5. Open or reload PocketWebTools Voice Cloning.
6. Click the extension icon and choose **Start**. Allow microphone access if Chrome asks.

## Behavior
- Uses Chrome SpeechRecognition.
- Attempts Chrome's on-device English recognition and installs the language pack if Chrome offers it.
- Uses speech/sound end events and waits 2.5 seconds before inserting final recognized words into the TTS field and clicking Generate.
- Does not play generated audio.

## Important network limitation
The extension itself cannot repair Chrome's online SpeechRecognition network service. When Chrome does not offer on-device recognition or its offline language pack is unavailable, the extension falls back to the same online service that can produce `network` errors. That may require checking internet access, VPN/firewall rules, or Chrome speech-service availability.

If Chrome's offline pack is available, the extension requests local recognition to avoid the online service. The extension does not upload audio itself.
