# ChatGPT Echo Guard

Chrome Manifest V3 extension that captures your microphone and ChatGPT tab audio, transcribes locally with the separate Windows EXE, and compares the recognized words. When it detects a mismatch, it sends **one recovery prompt** to the current chat. It does not send every microphone phrase as a message. ChatGPT tab audio is passed through in real time; Echo Guard does not buffer or replace playback.

## Important limitation

A normal Chrome extension cannot edit ChatGPT Voice Mode's private internal live-recognition transcript. This version sends a recovery instruction only after a detected mismatch, not on every microphone phrase. It has a 15-second cooldown and will not re-arm until a matching echo is detected again. **Important:** sending text may interrupt or exit Voice Mode, and the extension cannot guarantee the current ChatGPT interface will allow text submission while voice is active. If no composer is available, it retries briefly and reports the limitation in the panel.

## Install the Chrome extension

1. Download the repository or its `chatgpt-echo-guard` folder.
2. Visit `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**.
3. Select the `chatgpt-echo-guard` folder, or click **Reload** if already installed.
4. Open `https://chatgpt.com` in Chrome and refresh the page.

## Get the local audio-comparison EXE

1. Open the [Echo Guard EXE build workflow](https://github.com/nezoko45-dev/voicechanger/actions/workflows/build-echo-guard-exe.yml).
2. Open the latest successful **Build Windows Echo Guard Transcriber EXE** run.
3. Under **Artifacts**, download `EchoGuardTranscriber-Windows-x64` and extract `EchoGuardTranscriber.exe`.
4. Double-click `EchoGuardTranscriber.exe` and leave its console window open.
5. The first launch downloads the English Whisper model. This one-time download requires internet; after the model is cached, transcription runs locally/offline.
6. Open the Echo Guard extension popup and click **Start live transcript helper**. Allow microphone access if Chrome asks.
7. Speak normally. Echo Guard compares short microphone and ChatGPT audio phrases locally. If a mismatch is detected, it sends one recovery prompt asking ChatGPT to resume repeating; it will not send another until a matching echo re-arms recovery, with a 15-second cooldown.

## How it works

- The extension captures microphone and ChatGPT tab audio separately.
- ChatGPT's audio continues playing live through the extension's audio worklet; it is not held for transcription.
- Short segments are sent to the EXE over loopback at `http://127.0.0.1:8765/transcribe`.
- Faster-Whisper transcribes the audio locally. The on-page panel displays the transcript estimates and flags a mismatch when the local comparison detects one.
- On a mismatch episode, the extension forwards one recovery prompt to the current ChatGPT page, fills the composer, and clicks Send if those controls are available. It suppresses rapid repeats and re-arms after a matching echo.
- The server binds to `127.0.0.1` only. Audio is processed locally and is not sent to a cloud transcription API.

## Controls and privacy

- **Start live transcript helper** starts microphone and ChatGPT tab capture.
- **Stop transcript helper** ends capture.
- **Arm transcript fallback** retains the older visible-text check when audio comparison is not running.
- Headphones help prevent the microphone from hearing ChatGPT's speaker output and confusing it with your speech.
- The EXE does not require Python to be installed separately.

## Troubleshooting

- If the popup says the local server is unavailable, run `EchoGuardTranscriber.exe` and keep its console open. It should show `127.0.0.1:8765`.
- If the first launch fails to download the model, reconnect to the internet and launch the EXE again.
- If microphone access fails, allow microphone access in Chrome permissions, then stop and restart capture.
- The first model load can take time and uses CPU; transcription may lag on slower computers.
- ChatGPT's tab controls and Voice Mode UI can change, so the helper does not rely on a supported API to alter ChatGPT's internal transcript.
- The EXE is built by GitHub Actions but has not been runtime-tested on your specific Windows machine. Windows may show a SmartScreen warning because the EXE is unsigned; only run builds from the repository you trust.
