# Fish Audio Auto Clicker

A Chrome extension that watches the active Fish Audio tab and automatically clicks the visible **Call again** button when it becomes available.

Branch: https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation

## Setup

1. Download the ZIP from **Code → Download ZIP** on this branch and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, and load the extracted folder using **Load unpacked** (or reload the existing unpacked extension).
3. Open [Fish Audio](https://fish.audio/) and navigate to the page where **Call again** appears.
4. Click the extension icon and choose **Start automatic clicking**.
5. Keep the Fish Audio tab open. Choose **Stop automatic clicking** in the extension popup to stop.

## Behaviour and limitations

- The clicker runs in the active Fish Audio tab and watches for DOM changes. It clicks once, then waits for the button to disappear or become disabled before re-arming for the next cycle, to avoid repeatedly clicking the same still-active button.
- If Fish Audio changes the button text or page implementation, detection may need adjustment.
- This automates clicking only; it does not use the microphone or generate speech.
- Changes are kept on `rebuild/uberduck-voice-dictation`; `main` is not modified.
