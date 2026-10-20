# ElevenLabs Voice Dictation for VRChat

Chrome extension for background speech dictation and voice playback. Version 1.9.0 adds optional direct ElevenLabs API generation from the dashboard so speech generation no longer depends on the ElevenLabs webpage UI.

Branch: https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation

## Install or update

1. Download ZIP from **Code → Download ZIP** on the branch page and extract it.
2. Open `chrome://extensions`, enable Developer mode, then reload the existing unpacked extension or use **Load unpacked** on the extracted folder.
3. Confirm version **1.9.0**.
4. Open the extension toolbar button and click **Open voice dashboard**.
5. Start dictation and allow microphone access.
6. To bypass the ElevenLabs webpage, enable **Direct API**, enter your ElevenLabs API key and voice ID, select a model, and click **Save API settings**. Your key is stored locally in Chrome extension storage; never share it or commit it to the repository.
7. Keep the dashboard tab open for audio playback. Configure Windows sound output / your virtual audio cable so the generated speech is routed to the microphone input selected in VRChat.

## Direct API

The extension calls `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` with your key and chosen model. It uses MP3 output, then plays the response from the dashboard. API usage consumes the credits associated with your ElevenLabs account. API docs: https://elevenlabs.io/docs/api-reference/text-to-speech/convert

## Website mode

If Direct API is unchecked, dictation continues to populate and generate speech on the ElevenLabs website as before. The website may still freeze in background tabs.

## Troubleshooting

- **API key error:** Check key validity and Text to Speech permissions.
- **HTTP 429:** Check usage/quota and rate limits.
- **Audio generated but not heard:** Click the dashboard once to allow playback, check Windows volume/output device, and ensure the virtual cable routes to VRChat's selected microphone.
- **No transcript:** Check microphone permissions and the dashboard status.
- **Website mode not connecting:** Refresh the ElevenLabs Text to Speech tab after updating the extension.

## Limitations

Speech recognition uses Chrome's Web Speech API in an offscreen extension document. Direct API mode avoids controlling the ElevenLabs webpage but still requires network access, an API key, and available account credits. Voicebox WAV loading is a separate issue and needs its exact error message and a sample file's properties to diagnose. No live Chrome/VRChat test has been run.
