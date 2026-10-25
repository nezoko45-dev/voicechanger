# Character.AI Voice Dictation

A Manifest V3 Chrome extension using Chrome's Web Speech API to dictate into the Character.AI composer.

## Behavior
- Click the extension icon and choose **Start dictation**.
- Each new dictated message starts with the word `repeat`.
- Automatically clicks Send after about 1.2 seconds without recognized speech.
- When Chrome ends or times out a recognition session, the extension automatically starts a fresh session. Retries use a short backoff if Chrome refuses to restart immediately.
- Watches for clicks on the exact **Voice** playback button beneath individual Character.AI replies. If playback is not detectable after about 2.2 seconds, it toggles that button off and back on once.
- Click **Stop dictation** to stop listening.

## Install/update
1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this `cai-dictation` folder, or click **Reload** if already installed.
3. Refresh your Character.AI chat, allow microphone access, then click the extension icon → **Start dictation**.

## Notes
- Uses Chrome's speech-recognition service, not local Whisper; network requirements depend on Chrome's implementation.
- Chrome generally uses the default input device for its recognition service; this extension does not directly select a microphone stream.
- Automatic restarts help recover from timeouts but cannot guarantee uninterrupted operation if Chrome, the operating system, microphone permission, or the speech service prevents recognition.
- Automatic sending skips transcript review. Character.AI may change its page structure, affecting the Send button.
- Voice recovery is best-effort: Character.AI may use Web Audio or change its playback controls, so the extension cannot always reliably detect whether sound actually started. It only reacts after a reply playback control is clicked and makes at most one recovery attempt per click.
