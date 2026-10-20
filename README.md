# Inworld Voice Dictation for VRChat

Chrome extension for one-button background speech dictation and Inworld AI text-to-speech playback. Version 2.0.0 replaces the previous ElevenLabs integration with Inworld's TTS API.

Branch: https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation

## Install or update

1. Download ZIP from **Code → Download ZIP** on the branch page and extract it.
2. Open `chrome://extensions`, enable Developer mode, then reload the existing unpacked extension or use **Load unpacked** on the extracted folder.
3. Open the extension toolbar button and click **Open voice dashboard**.
4. In the dashboard, paste your complete Base64 API credential from the Inworld Portal, enter the exact voice ID, select a model, and click **Save Inworld settings**.
5. Click **Start dictation + generation** and allow microphone access. Speak naturally; after about 3 seconds of silence, the phrase is sent to Inworld for synthesis.
6. Keep the dashboard tab open for playback. Set Windows playback output to your virtual audio cable, then choose the cable's corresponding input as the microphone in VRChat.

## How generation works

The extension uses Inworld's documented endpoint, `POST https://api.inworld.ai/tts/v1/voice`, with `Authorization: Basic <INWORLD_API_KEY>`. The key is the complete Base64 credential copied from the Inworld Portal and must not be encoded again. The response contains Base64 audio, which the dashboard plays. See https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech

This implementation calls the official API instead of automating the website's Generate button. That avoids brittle website selectors and background-tab UI freezes. The credential is stored in local Chrome extension storage for this personal extension; do not share the profile or commit credentials to GitHub. API usage may be billed to your account.

## Troubleshooting

- **HTTP 401/403:** Paste the complete Base64 credential copied from Inworld without re-encoding it; check account access.
- **HTTP 429:** Check account usage and rate limits.
- **No audio:** Click the dashboard once to allow playback, check Windows output/volume, and ensure the virtual cable is selected as VRChat's microphone input.
- **No transcript:** Check microphone permissions and the dashboard status.
- **Voice not found:** Verify the exact voice ID available to your Inworld account.
- **No generation after speech:** Ensure Auto-generate after silence is enabled and that the dashboard has saved credentials.

## Limitations

Speech recognition uses Chrome's Web Speech API in an offscreen extension document. Audio is played by the dashboard and relies on Windows/virtual-cable routing. No live Chrome/VRChat test has been run.
