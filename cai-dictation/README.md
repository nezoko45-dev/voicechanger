# Talkie + Character.AI Voice Dictation

A Manifest V3 Chrome extension using Chrome's Web Speech API to dictate into Talkie (talkie-ai.com) or Character.AI.

## Behavior
- Click the extension icon and choose **Start dictation**.
- Dictated messages are prefixed with `repeat`.
- Automatically sends after about 1.2 seconds without recognized speech.
- Waits for a new assistant reply and tries to click its audio play button after the reply appears stable for 2.5 seconds. Site markup varies, so automatic playback is best-effort.
- Automatically restarts Chrome speech recognition when sessions end or time out.
- Click **Stop dictation** to stop listening.

## Install/update
1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this `cai-dictation` folder, or click **Reload** if already installed.
3. Open a Talkie or Character.AI chat, refresh the tab, allow microphone access, then click the extension icon → **Start dictation**.

## Notes
- Uses Chrome's speech-recognition service, not local Whisper; network requirements depend on Chrome's implementation.
- Chrome generally uses the default input device for its recognition service; this extension does not directly select a microphone stream.
- Automatic sending skips transcript review. The sites may change their composer, Send button, reply structure, or audio controls, which can affect detection.
- The extension has not been verified against Talkie's live page. Test with a short message first.
