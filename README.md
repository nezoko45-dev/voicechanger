# TTSLab Fast Dictation

A minimal Chrome extension for hands-free dictation on [TTSLab.dev](https://ttslab.dev/).

## Use

1. Download the ZIP from **Code → Download ZIP** on this branch and extract it.
2. Open `chrome://extensions`, enable Developer mode, and use **Load unpacked** (or reload the existing unpacked extension).
3. Open the specific TTSLab tool/model page with its text box and **Stream** button. Keep it open in a tab.
4. Click the extension icon and choose **Start listening**. Allow microphone access.
5. Speak naturally. Your words appear in the TTSLab text field while you speak. After a brief pause (about 1.2 seconds after speech is recognized), the extension automatically clicks **Stream** or **Send**.
6. Keep talking to submit more phrases. Press **Stop listening** only when you are finished.

## Why this version is simpler

- No dashboard or automatic tab switching.
- Speech recognition runs in a Chrome offscreen document; submissions go directly to the open TTSLab tab even if it is not the active tab.
- Interim transcript previews are written into the TTSLab field while you speak.
- A short pause submits the completed phrase automatically; dictation keeps listening for the next phrase.
- Duplicate suppression, control detection, and automatic recognition reconnects.

## Limitations

Chrome speech recognition can still have service-side latency and may behave differently across Chrome versions. The TTSLab text field and Stream button selectors are generic and need live-page testing.

All changes are on `feature/ttslab-fast-dictation`. The `main` branch was not changed.
