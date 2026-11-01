# LiveKit TTS setup

The GitHub Pages reader is static, so it cannot safely hold LiveKit credentials. The LiveKit TTS endpoint in `api/livekit-tts.js` must run on a server.

## Deploy the endpoint on Vercel

1. In Vercel, create a new project and import `nezoko45-dev/voicechanger`.
2. Keep the project root directory set to the repository root.
3. Add these environment variables under Project Settings → Environment Variables:
   - `LIVEKIT_API_KEY` — your LiveKit Cloud API key
   - `LIVEKIT_API_SECRET` — its matching secret
4. Add them to Production (and Preview too if you want preview deployments to work), then redeploy.
5. Your endpoint URL will be `https://YOUR-VERCEL-PROJECT.vercel.app/api/livekit-tts`.
6. Open the GitHub Pages reader and paste that URL into the “LiveKit TTS endpoint” field.

Do not put the API key or secret in the GitHub repository or in the reader's browser fields.

## Reader configuration

- Engine: **LiveKit — Fish Audio S2.1 Pro**
- Fish Audio voice ID: the field accepts a voice ID from the LiveKit/Fish Audio voice library. A documented example ID is prefilled.
- The endpoint accepts JSON `{ "text": "...", "voice": "..." }` and returns WAV audio.
- Each request is limited to 3,000 characters.

LiveKit Inference usage is subject to your LiveKit plan and model pricing/quotas. The current LiveKit documentation lists `fishaudio/s2.1-pro`; the older `fishaudio/s2.1-pro-free` model is retired.
