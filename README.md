# Fast Dictation for TTSLab + Fish Audio

A minimal Chrome extension for hands-free dictation on [TTSLab.dev](https://ttslab.dev/) and [Fish Audio](https://fish.audio/).

## Use

1. Download the ZIP from **Code → Download ZIP** on this branch and extract it.
2. Open `chrome://extensions`, enable Developer mode, and use **Load unpacked** (or reload the existing unpacked extension).
3. Open the TTSLab tool/model page with its **Stream** button, or Fish Audio’s text-to-speech page with its **Generate Speech** button. Keep it open in a tab.
4. Click the extension icon and choose **Start listening**. Allow microphone access.
5. Speak naturally. Your words appear in the TTSLab text field while you speak. After a brief pause (about 1.2 seconds after speech is recognized), the extension automatically clicks **Generate Speech**, **Stream**, or **Send**, depending on the page.
6. Keep talking to submit more phrases. Press **Stop listening** only when you are finished.

## Why this version is simpler

- No dashboard or automatic tab switching.
- Speech recognition runs in a Chrome offscreen document; submissions go directly to the open TTSLab or Fish Audio tab even if it is not the active tab.
- Interim transcript previews are written into the TTSLab or Fish Audio field while you speak.
- A short pause submits the completed phrase automatically; dictation keeps listening for the next phrase.
- Duplicate suppression, control detection, and automatic recognition reconnects.

## Limitations

Chrome speech recognition can still have service-side latency and may behave differently across Chrome versions. The TTSLab and Fish Audio text-field/button selectors are generic and need live-page testing.

All changes are on `feature/ttslab-fast-dictation`. The `main` branch was not changed.


## Local Voice Clone Studio (VoiceClonNX)

This branch also includes an opt-in local voice-conversion studio. It records short phrases from your microphone, converts each phrase to a reference voice WAV you select, then lets you play or download each result. The reference and source recordings are processed by a local Python helper; they are not uploaded to a hosted voice service by this extension.

### Setup

1. Install Python 3.10+.
2. From this repository folder, run `python -m venv .venv`, activate the environment, then run `pip install -r voiceclonnx_helper/requirements.txt`.
3. Start the helper with `python voiceclonnx_helper/server.py`. It binds only to `127.0.0.1:8765`.
4. Reload the unpacked extension at `chrome://extensions`, click the extension icon, and choose **Open Voice Clone Studio**.
5. In the studio, choose a WAV recording of your own voice as the reference, click **Save reference voice**, then **Start microphone**. Speak a phrase and pause; the studio sends each detected phrase to the local helper for conversion.
6. Play or download the resulting WAV clips from the studio.

The first conversion may download model weights and can take time. VoiceClonNX is audio-to-audio voice conversion, not text-to-speech; it transforms each captured spoken phrase to the reference voice. The initial implementation uses the FACodec engine. Model availability, dependencies, microphone permission, and real-time performance depend on your computer.

See [VoiceClonNX documentation](https://github.com/TigreGotico/voiceclonnx) for engine behavior and model-weight licensing. Use reference recordings only when you have permission to use that voice.
