# Custom WAV voice for the GitHub Pages reader

The reader keeps its existing browser microphone dictation and automatic recovery. Fish Audio is used only for read-aloud.

## 1. Deploy the private API routes

Deploy this repository to Vercel as a project with the repository root as its Root Directory. The two serverless routes are:

- `/api/fish-create-voice` — receives the selected WAV and creates a private Fish Audio TTS voice.
- `/api/fish-reference-tts` — synthesizes text using the saved voice ID.

In Vercel, add this environment variable to the project:

- `FISH_AUDIO_API_KEY` — your Fish Audio API key.

Redeploy after adding the variable. Never put the API key in the GitHub Pages HTML.

The WAV upload endpoint accepts WAV files up to 4 MB because of serverless request-size limits. Use a clean, single-speaker sample with little background noise. A 10–30 second clip is a useful starting point. Fish Audio's voice model creation endpoint supports private TTS models and fast training.

## 2. Configure the GitHub Pages reader

Open:

`https://nezoko45-dev.github.io/voicechanger/openrouter-tts-reader/`

1. Paste the Vercel project base URL into **Private API backend URL** (for example, `https://your-project.vercel.app`).
2. Choose **Fish Audio — my custom WAV voice** as the speech engine.
3. Select the WAV file, optionally enter its transcript, then click **Upload WAV & create voice**.
4. Once the voice ID appears, click **Read aloud**. The voice ID is saved in this browser's local storage.

Dictation continues to use the page's existing Chrome/Edge Speech Recognition implementation. The microphone is paused while generated speech plays, then automatically resumes afterward.

## Notes

- The voice is created as private in the Fish Audio account associated with the API key.
- Voice creation is a one-time step per reference WAV; subsequent readings reuse the saved voice ID.
- Fish Audio charges according to the account's current API pricing and plan.
- This integration does not require the desktop EXE or LiveKit.
