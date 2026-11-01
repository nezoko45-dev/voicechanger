# LiveKit Voice Reader for Windows

A standalone Windows desktop app for microphone dictation and Fish Audio neural read-aloud using LiveKit Inference.

## Features
- LiveKit Fish Audio S2.1 Pro neural speech.
- Female voice presets (Laura, Selene, Sarah, Hannah) plus a default voice ID.
- Microphone dictation through Chromium's Web Speech Recognition when supported by the Windows/Electron runtime.
- Pause, resume, stop, and speaking-speed controls.
- LiveKit API key and secret encrypted with Electron `safeStorage` on the local Windows PC.
- No Vercel backend, Python, or browser tab required.

## Build on Windows
1. Install Node.js 22 LTS.
2. Open a terminal in this directory.
3. Run `npm install`.
4. Run `npm run dist:win`.
5. Find the installer in `dist/`.

A GitHub Actions workflow also builds a Windows installer on pushes to this folder and manual workflow dispatch.

## Credentials and billing
Create a LiveKit Cloud API key and secret, enter them in the app, and choose **Save securely on this PC**. The secret is encrypted with Windows-backed Electron safeStorage and is not committed to this repository. Speech generation uses LiveKit Inference, so usage follows your LiveKit plan, model availability, and billing. The retired `fishaudio/s2.1-pro-free` model is not used.

## Notes
- LiveKit inference model: `fishaudio/s2.1-pro`.
- Suggested voice IDs and model settings follow LiveKit's current Fish Audio TTS documentation.
- Dictation depends on the Chromium speech-recognition service being available on the PC. Manual text entry and neural speech output work independently of dictation.
