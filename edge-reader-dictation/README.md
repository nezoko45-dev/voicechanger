# Microsoft Edge Reader — GitHub Pages

A browser-only dictation and text-to-speech page. No executable, Python, localhost service, API key, or hosted TTS provider is required.

## Features
- Continuous speech recognition using the browser Web Speech API.
- Automatically restarts recognition when a recognition session ends.
- Refreshes the recognition session about every 50 seconds to reduce long-session stalls.
- Retries recoverable network, no-speech, and service interruptions with backoff.
- Preserves text already transcribed when recognition restarts.
- Uses browser speech synthesis and exposes available Microsoft / Windows voices.
- Manual read-aloud, pause, resume, and stop controls.
- Optional sentence-by-sentence read-aloud.

## Use
Open `index.html` through the repository's GitHub Pages site in current Microsoft Edge. Allow microphone access. Select a voice and press **Start dictation**.

Speech recognition is provided by the browser and may depend on its online recognition service; the page itself does not host a speech-recognition model. Voice availability depends on Edge and Windows.

## Limitations
The Web Speech Recognition API does not expose a reliable low-level voice-activity/silence signal. This page uses recognition results and session end/error events to manage restarts; it does not claim to perform true microphone-level silence detection.
