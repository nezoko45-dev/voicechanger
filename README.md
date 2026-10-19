# Inworld AI Voice Dictation

A Chrome/Chromium Manifest V3 extension that transcribes speech into Inworld AI's text-to-speech text box and tries to click **Generate** after a short pause.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or a Chromium-based browser.
3. Enable **Developer mode**.
4. Click **Reload** on the extension (or remove the old copy and load this repository folder using **Load unpacked**).
5. Open your Inworld AI TTS page and refresh it.
6. Click **Start dictation** on the floating panel and allow microphone access if prompted.
7. Speak naturally. After about 2.2 seconds of silence, the extension inserts the latest transcript, waits for the page to update, and tries to click a visible Generate button. Continue speaking for another phrase, or click Stop to finish.

## Notes

- Uses the browser's Web Speech API for speech-to-text; browser support and microphone permissions apply.
- The extension runs on `inworld.ai` and its HTTPS subdomains.
- The floating status message distinguishes speech recognition, text-box detection, Generate-button detection, and clicking.
- Turn off **Generate after pause** to transcribe into the text box without automatically generating audio.
- Inworld may change its page layout. If status says it cannot find the text box or Generate button, the selectors need to be tailored to the exact TTS page.
- The extension has not been live-tested against every current Inworld interface.
