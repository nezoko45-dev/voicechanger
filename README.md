# Fish Audio Call Again Clicker

A small Chrome extension that clicks the visible **Call again** button on Fish Audio when you press the extension's popup button.

Branch: https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation

## Setup

1. Download the ZIP from **Code → Download ZIP** on the branch page and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, and load the extracted folder with **Load unpacked** (or reload the existing unpacked extension).
3. Open [Fish Audio](https://fish.audio/) and navigate to the page where **Call again** is visible.
4. Click the extension icon, then click **↻ Call again**.
5. The popup reports whether it found and clicked the button.

## Notes

- This is a manual, one-click helper. It does not use the microphone, dictate text, or automatically repeat clicks.
- The button is detected by its visible text or accessible label. Fish Audio may change its page layout or wording; if detection fails, refresh the page and try again.
- Changes are kept on `rebuild/uberduck-voice-dictation`. The `main` branch is not modified.
