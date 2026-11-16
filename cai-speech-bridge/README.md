# CAI Speech Bridge
1. Download/run **CAI-Bridge.exe** (from Actions artifact or Releases).
2. Open https://nezoko45-dev.github.io/voicechanger/cai-speech-bridge/ in Chrome.
3. Open Character.AI in Chrome and click Start listening on the bridge.
4. Chrome SpeechRecognition sends transcripts to the helper; helper pastes into CAI and presses Enter. Voice toggle is attempted through Windows UI Automation.

The helper listens only on 127.0.0.1:8788. The bridge page requires Chrome SpeechRecognition support and microphone permission.

GitHub Pages: enable Pages for this repository (branch containing this folder, root), or publish this folder through the existing Pages workflow. The source path is /cai-speech-bridge/.
