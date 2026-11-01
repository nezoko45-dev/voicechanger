# Fish Audio Local Backend (Windows)

This local Rust server replaces the Vercel API routes used by the GitHub Pages reader.

## Run it

1. Download and extract the Windows backend ZIP from the GitHub Actions artifact named `fish-audio-local-backend-windows`.
2. Double-click `start.bat`.
3. Paste your Fish Audio API key when prompted.
4. Keep the black backend window open.
5. Open the GitHub Pages reader: https://nezoko45-dev.github.io/voicechanger/openrouter-tts-reader/
6. Leave the reader's Local backend URL set to `http://127.0.0.1:3000`.

The API key is supplied to the local process and is never sent to GitHub Pages. The server binds only to 127.0.0.1 (this PC), accepts browser requests only from the official GitHub Pages origin, and supports Chrome's Private Network Access preflight.

## Endpoints

- `GET /` health check
- `POST /api/fish-create-voice` multipart WAV upload
- `POST /api/fish-reference-tts` JSON text-to-speech request

No Vercel project, deployment, or reader access code is needed.
