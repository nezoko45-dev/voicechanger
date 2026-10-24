# Fish Audio Repeater Clicker

Chrome extension on branch `rebuild/uberduck-voice-dictation` that has two cooperating features:

1. **Automatic Call again clicker:** watches the actual visible/enabled Fish Audio **Call again** control and clicks it once per button cycle. It does not spam-click at a fixed interval.
2. **Local transcript mismatch recovery:** captures your microphone and Fish Audio tab audio, transcribes both locally with Faster-Whisper, compares the words, and requests one **Call again** click after a detected mismatch. A 15-second cooldown prevents rapid duplicate recovery clicks.

Repository branch: https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation

## Install the extension

1. Download the ZIP from **Code → Download ZIP** on this branch and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the extracted extension folder (the folder containing `manifest.json`).
4. Open Fish Audio and navigate to the repeater/call page.

## Enable automatic clicking

Open the extension popup and click **Start auto-clicking Call again**. The extension watches page changes and clicks the actual enabled button, then waits for the next button cycle before clicking again. Keep the Fish Audio tab open.

## Enable local mismatch recovery

This requires Python and the one-time Faster-Whisper model setup. Audio clips are sent only to the local service at `127.0.0.1:8765`, not to a cloud transcription API.

1. Open a terminal in the extracted extension folder.
2. Run:
   ```bat
   python -m pip install -r local-transcriber\requirements.txt
   python local-transcriber\server.py
   ```
3. Wait for the model to finish loading. The first run downloads the Whisper model; later runs can work locally with the cached model.
4. In Chrome, open `http://127.0.0.1:8765/health` and check that it reports `"ok": true`.
5. Return to Fish Audio, click the extension icon, and choose **Start local mismatch monitor**. Approve microphone access if Chrome asks.
6. For both behaviors at once, turn on **Start auto-clicking Call again** as well.

On a transcript mismatch, the extension attempts one Call again click. If the button is not yet available, the independent auto-click watcher can click it when it appears. Repeated mismatches are throttled for 15 seconds.

## Notes and limitations

- The extension compares local speech-recognition text, not Fish Audio's private internal transcript. Speech recognition can make mistakes, especially with music, noise, short phrases, or differing punctuation.
- The microphone and tab audio are captured by Chrome. Tab capture can change how audio is routed while monitoring; test with your intended headset/output setup.
- This code has been committed but not yet tested against the live Fish Audio page. Fish Audio can change its page labels or behavior, which may require selector adjustments.
- Keep the Fish Audio tab open. Stop both controls when finished.
