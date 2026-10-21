# TTSLab Fast Dictation

A minimal Chrome extension for hands-free dictation on [TTSLab.dev](https://ttslab.dev/).

## Use

1. Download the ZIP from **Code → Download ZIP** on this branch and extract it.
2. Open `chrome://extensions`, enable Developer mode, and use **Load unpacked** (or reload the existing unpacked extension).
3. Open the specific TTSLab tool/model page with its text box and **Stream** button. Keep it open in a tab.
4. Click the extension icon and choose **Start listening**. Allow microphone access.
5. Speak naturally. After a short pause (about 1.4 seconds), the extension enters the recognized phrase and clicks **Stream**.
6. Open the extension popup and choose **Stop listening** to stop.

## Why this version is simpler

- No dashboard or automatic tab switching.
- Speech recognition runs in a Chrome offscreen document; submissions go directly to the open TTSLab tab even if it is not the active tab.
- Interim transcript previews are not repeatedly written into the page, reducing competing DOM updates.
- Short pause timer, duplicate suppression, quick control detection, and automatic recognition reconnects.

## Limitations

Chrome speech recognition can still have service-side latency and may behave differently across Chrome versions. The TTSLab text field and Stream button selectors are generic and need live-page testing.

All changes are on `feature/ttslab-fast-dictation`. The `main` branch was not changed.
