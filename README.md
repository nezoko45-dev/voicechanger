# Inworld AI Voice Dictation

A Chrome/Chromium Manifest V3 extension that continuously transcribes speech into Inworld AI's text-to-speech text box and clicks **Generate** after a short pause.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or a Chromium-based browser.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this repository folder.
5. Open [Inworld AI](https://inworld.ai/) or a supported Inworld page and reload it.
6. Click **Start dictation** on the floating panel and allow microphone access if prompted.
7. Speak naturally. After about 1.8 seconds of silence, the extension inserts the latest transcription into the TTS text box and tries to click **Generate**. Continue speaking to generate another phrase, or click Stop to finish.

## Notes

- Uses the browser's Web Speech API for speech-to-text; browser support and microphone permissions apply.
- The extension tries to find the TTS text box and a nearby **Generate** button using accessible labels, placeholders, and visible page controls. Inworld may change its page layout, so the selectors may need adjustment.
- Turn off **Generate after pause** to collect transcription in the text box without automatically generating audio.
- The extension has not been live-tested against every current Inworld interface.
- The extension runs on `inworld.ai`, `platform.inworld.ai`, and `studio.inworld.ai`.
