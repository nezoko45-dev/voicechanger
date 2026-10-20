# tts.dev Voice Dictation

Chrome extension for hands-free speech input on tts.dev. It listens through Chrome's speech recognition, previews the transcript in the page's text field, and clicks **Stream** after about 3 seconds of silence.

Branch: https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation

## Setup

1. Download the ZIP from **Code → Download ZIP** on the branch page and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, and load the extracted folder using **Load unpacked** (or reload the existing unpacked extension).
3. Open [tts.dev](https://tts.dev/) in a Chrome tab and wait for its text field and **Stream** button to appear.
4. Open the extension's **tts.dev Voice Dictation** dashboard and click **Start listening**.
5. Allow microphone access, then speak. The transcript is entered into tts.dev and **Stream** is clicked after roughly 3 seconds of silence.
6. Keep the tts.dev tab open while using other apps. Click **Stop listening** to stop.

## Notes

- This uses browser speech recognition and page UI automation; it does not call a tts.dev API.
- The page's current DOM could not be verified from this environment, so the text field and **Stream** detection still need to be tested on the live page.
- Keep tts.dev open in Chrome. If the text box or button cannot be identified, refresh tts.dev and reload the extension at `chrome://extensions`.
- Changes are kept on `rebuild/uberduck-voice-dictation`; `main` was not modified.
- Background speech recognition availability depends on the user's Chrome build and microphone permissions.
