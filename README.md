# Uberduck Voice Dictation

A minimal Chrome/Chromium Manifest V3 extension that listens to your speech, puts the recognized words into Uberduck's text-to-speech input, and optionally clicks Generate Speech after you pause.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or a Chromium-based browser.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this repository folder.
5. Open [uberduck.ai](https://uberduck.ai/) and reload the page.
6. Click the floating **Start dictation** button and allow microphone access if prompted.
7. Speak, then pause for about 1.3 seconds. The recognized sentence is inserted and auto-generation runs if enabled.

## Notes

- Uses the browser's Web Speech API; it inserts recognized **text**, not a recorded audio file.
- Speech recognition availability depends on browser support and microphone permissions.
- Uberduck may change its page markup. If its text field or Generate button can't be found, the status label explains that.
- The extension only runs on uberduck.ai pages. It does not include or transmit an audio recording to a third-party transcription endpoint.
- Use the checkbox on the floating panel or extension popup to turn automatic generation on/off.
