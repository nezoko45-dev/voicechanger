# ElevenLabs Voice Dictation for VRChat

Chrome extension for speech dictation into ElevenLabs Text to Speech. Version 1.8.0 adds a full-size dashboard tab at `dashboard.html`, opened from the extension toolbar popup. The dashboard provides start/stop controls, live transcript, auto-send setting, and a shortcut to ElevenLabs. Speech recognition runs in an extension offscreen document; the service worker bridges messages to the ElevenLabs tab.

Branch: https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation

## Install or update

1. Download ZIP from **Code → Download ZIP** on the branch page and extract it.
2. Open `chrome://extensions`, enable Developer mode, remove the old installed copy if necessary, then click **Load unpacked**.
3. Select the extracted folder that directly contains `manifest.json`, `dashboard.html`, `dashboard.js`, `content.js`, `offscreen.html`, `offscreen.js`, and `service-worker.js`.
4. Confirm version **1.8.0**.
5. Open the extension toolbar button and click **Open voice dashboard**.
6. Open ElevenLabs Text to Speech from the dashboard, sign in, and refresh that tab after installing/updating: https://elevenlabs.io/app/speech-synthesis/text-to-speech
7. Click **Start dictation** in the dashboard and allow microphone access. Speak a phrase; the transcript should appear in the dashboard and ElevenLabs field. After a pause of about 3 seconds, auto-send submits the phrase if enabled.
8. Switch to VRChat. Recognition runs in a persistent offscreen extension document rather than relying on the dashboard or side panel remaining focused. Your existing audio routing still needs to send ElevenLabs playback to the VRChat microphone input.

## Troubleshooting

- **No transcript:** Check the dashboard Status line. If speech recognition is unsupported or microphone access is denied, use current Chrome and allow microphone access.
- **Transcript appears in dashboard but not ElevenLabs:** Refresh the ElevenLabs tab after updating the extension so the content script is injected.
- **Text arrives but audio does not generate:** Check the status line, ensure you're signed in, and verify the ElevenLabs text field and Generate button are visible.
- **Dashboard does not open:** Reload the extension at `chrome://extensions` and confirm the selected folder contains `manifest.json`.
- **ElevenLabs still freezes:** The dashboard does not itself replace the ElevenLabs webpage. Chrome may throttle that page in the background; keeping ElevenLabs active or using a direct API integration would avoid relying on its webpage UI.

## Limitations

Speech recognition uses the browser Web Speech API in an extension offscreen document and depends on Chrome support, microphone permissions, and network availability. Background recognition has not been verified in the user's live Chrome/VRChat setup. ElevenLabs can change its page UI, requiring updates to text-field or Generate-button detection. Audio routing is not controlled by this extension. Generated speech consumes normal ElevenLabs quota/credits. No live Chrome test has been run.
