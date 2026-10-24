# ChatGPT Echo Guard

Chrome Manifest V3 extension for a voice-repeater workflow. The extension captures microphone audio and the active ChatGPT tab's audio. A separate **local Windows EXE** transcribes each audio stream using Faster-Whisper, and the extension compares the recognized words. A mismatch can trigger the extension's new-chat/restart behavior.

## Install the Chrome extension

1. Download the repository or just its `chatgpt-echo-guard` folder.
2. Visit `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**.
3. Select the `chatgpt-echo-guard` folder, or click **Reload** if already installed.
4. Open `https://chatgpt.com` in Chrome and refresh the page.

## Get the local audio-comparison EXE

1. Open the [Echo Guard EXE build workflow](https://github.com/nezoko45-dev/voicechanger/actions/workflows/build-echo-guard-exe.yml).
2. Open the latest successful **Build Windows Echo Guard Transcriber EXE** run.
3. Under **Artifacts**, download `EchoGuardTranscriber-Windows-x64` and extract `EchoGuardTranscriber.exe`.
4. Double-click `EchoGuardTranscriber.exe` and leave its console window open.
5. The first launch downloads the English Whisper model. This one-time download requires internet; after the model is cached, transcription runs locally/offline.
6. Open the Echo Guard extension popup and click **Start local audio comparison**. Allow microphone access if Chrome asks.
7. Use ChatGPT Voice Mode and speak a short phrase, then wait for the response. Headphones help prevent feedback.

## How it works

- The extension captures the microphone and ChatGPT tab as separate audio streams.
- Short audio segments are sent to the EXE over loopback at `http://127.0.0.1:8765/transcribe`.
- The EXE runs Faster-Whisper locally and returns recognized text. The extension normalizes punctuation/case and compares the phrases.
- A mismatch is reported to the extension, which handles the browser-side new-chat/restart behavior.
- The server binds to `127.0.0.1` only and only accepts requests from a Chrome extension origin. Audio clips are held in memory and are not written to disk or sent to a cloud transcription API.

## Controls and privacy

- **Start local audio comparison** starts microphone and ChatGPT tab capture.
- **Stop audio comparison** ends capture.
- **Arm transcript fallback** keeps the older visible-text check available when audio comparison is not running.
- Keep Echo Guard disarmed for normal conversations; a non-echo answer intentionally triggers a new chat.
- Transcription is local. The EXE does not need Python installed separately.

## Troubleshooting

- If the popup says the local server is unavailable, run `EchoGuardTranscriber.exe` and keep its console open. It should show `127.0.0.1:8765`.
- If the first launch fails to download the model, reconnect to the internet and launch the EXE again.
- If microphone access fails, open Chrome site/extension permissions and allow microphone access, then stop and restart capture.
- Use headphones to prevent the microphone from hearing ChatGPT's own speaker output and confusing it with your speech.
- The first model load can take time and uses CPU; transcription may lag on slower computers.
- ChatGPT's tab controls and Voice Mode restart are best-effort because its interface can change.
- The EXE is built by GitHub Actions but has not been runtime-tested on your specific Windows machine. Windows may show a SmartScreen warning because the EXE is unsigned; only run builds from the repository you trust.
