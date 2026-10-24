# ChatGPT Echo Guard

Chrome Manifest V3 extension for a voice-repeater workflow. The optional **Local audio comparison** mode captures microphone input and the active ChatGPT tab's audio, transcribes each with a local Whisper model, and opens a new chat if the recognized words differ.

## Install or update

1. Download the repository or just its `chatgpt-echo-guard` folder.
2. Visit `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**.
3. Select the `chatgpt-echo-guard` folder, or click **Reload** if already installed.
4. Open `https://chatgpt.com` in Chrome and refresh it.
5. Open `chatgpt-echo-guard/local-transcriber` on your computer and run `setup-local-transcriber.bat` once. This installs the local speech-recognition packages. The English Whisper model downloads the first time you launch the local transcriber, so internet is required during setup/first launch.
6. Run `start-local-transcriber.bat` and leave its console window open.
7. Open the Echo Guard extension popup and click **Start local audio comparison**. Allow microphone access if Chrome asks.
8. Use ChatGPT Voice Mode with headphones if possible. Speak one short phrase and let ChatGPT respond.

## How audio comparison works

- Chrome captures the active ChatGPT tab's audio and your microphone as separate streams.
- Short speech segments are sent to the local service at `127.0.0.1:8765`; Faster-Whisper recognizes the words on your computer.
- The extension normalizes punctuation/case and compares the recognized text. A mismatch triggers the existing new-chat/restart behavior.
- The local service binds to loopback only and accepts requests from Chrome extension origins. It does not send audio to a cloud API.
- After the model is downloaded, transcription can run offline as long as the Python packages and model files remain installed.

## Controls and privacy

- **Start local audio comparison** starts mic and tab capture.
- **Stop audio comparison** ends capture.
- **Arm transcript fallback** keeps the older visible-text check available when audio comparison is not running.
- Keep Echo Guard disarmed for normal conversations; a non-echo answer intentionally triggers a new chat.
- Audio is processed locally. The audio clips are held in memory for transcription and are not written to disk by this extension.

## Troubleshooting

- If setup fails, install 64-bit Python 3.10–3.12 and run `setup-local-transcriber.bat` again.
- If the popup says the local server is unavailable, make sure `start-local-transcriber.bat` is running and shows `127.0.0.1:8765`.
- If microphone access fails, open Chrome site/extension permissions and allow microphone access, then stop and restart capture.
- Use headphones to prevent the microphone from hearing ChatGPT's own speaker output and confusing it with your speech.
- The first model load can take time and uses CPU; transcription may lag on slower computers.
- ChatGPT's tab controls and Voice Mode restart are best-effort because its interface can change.
- This feature has been committed to the repository but has not been live-tested against your specific Chrome/ChatGPT session.
