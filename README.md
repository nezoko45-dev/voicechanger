# TTSLab Voice Dictation

Chrome extension for hands-free speech input on [TTSLab.dev](https://ttslab.dev/). It listens through Chrome's speech recognition, previews the transcript in the page's text field, and clicks **Stream** after about 3 seconds of silence.

Branch: https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation

## Setup

1. Download the ZIP from **Code → Download ZIP** on the branch page and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, and load the extracted folder using **Load unpacked** (or reload the existing unpacked extension).
3. Open [TTSLab.dev](https://ttslab.dev/) in a Chrome tab and navigate to the specific tool/model page where the text field and **Stream** button appear.
4. Open the extension's **TTSLab Voice Dictation** dashboard and click **Start listening**.
5. Allow microphone access, then speak. The transcript is entered into TTSLab and **Stream** is clicked after roughly 3 seconds of silence.
6. Keep the TTSLab tab open while using other apps. Click **Stop listening** to stop.

## Notes

- This uses browser speech recognition and page UI automation; it does not call a TTSLab API.
- The site's live tool page and Stream control still need to be tested in Chrome; the homepage alone may not contain the input/button.
- Keep the specific TTSLab tool page open. If the text box or button cannot be identified, refresh that page and reload the extension at `chrome://extensions`.
- Changes are kept on `rebuild/uberduck-voice-dictation`; `main` was not modified.
- Background speech recognition availability depends on the user's Chrome build and microphone permissions.
