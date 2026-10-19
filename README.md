# ElevenLabs Voice Dictation for VRChat

Chrome extension for live speech transcription into ElevenLabs Text to Speech. A persistent offscreen extension document runs speech recognition independently of the visible side panel, intended to keep dictation running while VRChat is foreground. The floating button on ElevenLabs toggles listening.

Branch: https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation

## Install or update

1. Download ZIP from **Code → Download ZIP** on the branch page and extract it.
2. Open `chrome://extensions`, enable Developer mode, remove the old installed copy if necessary, then click **Load unpacked**.
3. Select the extracted folder that directly contains `manifest.json`, `sidepanel.html`, `sidepanel.js`, and `content.js`.
4. Confirm version **1.6.3**.
5. Open ElevenLabs Text to Speech and refresh the tab after installing/updating: https://elevenlabs.io/app/speech-synthesis/text-to-speech
6. Open the extension side panel and click **Start dictation**. Allow microphone access.
7. Speak a phrase. The live transcript should appear both in the side panel's Latest transcript area and in the ElevenLabs text field as you speak. After a 3-second pause, auto-send submits the phrase for generation.
8. Start dictation, then switch to VRChat; recognition now runs in a persistent offscreen document instead of the visible side panel. Your existing audio routing still needs to send ElevenLabs playback to the VRChat microphone input.

## Troubleshooting

- **No transcript in either place:** Read the side panel Status line. If it says speech recognition is unsupported or microphone access is denied, use current Chrome and allow microphone access.
- **Transcript appears in side panel but not ElevenLabs:** Refresh the ElevenLabs tab after updating the extension. The extension's content script must be injected into the current tab.
- **Transcript appears in ElevenLabs but no audio is generated:** Check the side panel Status line for the send/generation error, ensure you're signed in, and verify the ElevenLabs text field and Generate button are visible.
- **Blank panel:** Remove the stale extension and use Load unpacked on the extracted folder. The Start button is static HTML and should be visible even if JavaScript fails.
- **Panel won't open:** Chrome 116 or newer is required; the extension popup provides an error and a fallback to open the panel page in a tab.

## Limitations

Speech recognition uses the browser Web Speech API in a persistent offscreen document and depends on Chrome support, microphone permissions, and network availability. Offscreen recognition has not been verified in the user’s live Chrome/VRChat setup. ElevenLabs can change its page UI, requiring updates to text-field or Generate-button detection. Audio routing is not controlled by this extension. Generated speech consumes the normal quota/credits for your ElevenLabs account.

This branch update adds live transcript preview in the ElevenLabs text field and clearer error reporting. It has not been live-tested in your Chrome session.
