# Uberduck Voice Dictation

A minimal Chrome/Chromium Manifest V3 extension that continuously listens to your speech, enters each sentence into Uberduck's text-to-speech input after a short pause, and optionally clicks Generate Speech. Dictation stays on until you click Stop.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or a Chromium-based browser.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this repository folder.
5. Open [uberduck.ai](https://uberduck.ai/) and reload the page.
6. Click the floating **Start continuous dictation** button and allow microphone access if prompted.
7. Speak naturally. After each pause of about 1.3 seconds, the recognized sentence is inserted and auto-generation runs if enabled. Continue speaking; click **Stop continuous dictation** when finished.

## Notes

- Uses the browser's Web Speech API; it inserts recognized **text**, not a recorded audio file.
- Speech recognition availability depends on browser support and microphone permissions.
- The recognition session automatically restarts if the browser ends it, so dictation can continue across multiple sentences.
- Uberduck may change its page markup. If its text field or Generate button can't be found, the status label explains that.
- The extension only runs on uberduck.ai pages. It does not include or transmit an audio recording to a third-party transcription endpoint.
- Use the checkbox on the floating panel or extension popup to turn automatic generation on/off.
