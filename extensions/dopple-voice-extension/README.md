# Dopple Voice Dictation

Chrome extension for hands-free speech-to-text in Dopple.ai.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select `extensions/dopple-voice-extension`.
5. Open or refresh [Dopple.ai](https://dopple.ai/) and open a chat.
6. Click **Start** on the floating dictation panel and allow microphone access.

## Behavior

- Uses the browser Web Speech API for speech recognition.
- Runs recognition continuously and proactively rotates the recognition session about every 45 seconds.
- Restarts the session after it ends or encounters recoverable errors/timeouts.
- Keeps already-finalized recognized text buffered across session restarts.
- After a configurable silence pause (1.6 seconds by default), inserts the transcript into the chat composer and presses **Enter** to submit. It does not depend on a Send button.
- Includes Start, Stop, Send now, auto-submit toggle, and adjustable silence delay.

## Notes

- Web Speech API support and recognition quality depend on Chrome, network availability, and microphone permissions; it may not work offline.
- Keep the Dopple tab open while dictating.
- If Dopple changes its composer markup or does not submit on Enter, the selectors/key handling may need updating.
