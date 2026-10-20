# Inworld Website Voice Dictation for VRChat

Chrome extension for one-button dictation that fills the Inworld TTS Playground and clicks its actual **Generate** button. Work is on the development branch below; do not merge into `main` unless desired.

Branch: https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation

## Setup

1. Download ZIP from **Code → Download ZIP** on the branch page and extract it.
2. Open `chrome://extensions`, enable Developer mode, then reload the unpacked extension or load the extracted folder.
3. Open the extension dashboard and click **Open Inworld TTS Playground**.
4. Sign in on the Inworld TTS Playground, choose your voice/model, and leave that tab open.
5. Return to the dashboard, click **Start dictation + Generate**, and allow microphone access.
6. Speak naturally. After around three seconds of silence, the extension fills your phrase into the Inworld page and clicks its Generate button.
7. Set Windows playback output to your virtual audio cable and select the cable's corresponding input as VRChat's microphone.

## Important

This build intentionally automates the website UI. It does **not** call the Inworld TTS API and does not need an API key. The content script currently supports the official Portal TTS Playground at `https://platform.inworld.ai/tts-playground` and the public voice-generator page at `https://inworld.ai/voice-generator`. Website UI changes may require selector updates. Keep the page open and signed in while using dictation.

No live test has been run against a signed-in Inworld account or VRChat.
