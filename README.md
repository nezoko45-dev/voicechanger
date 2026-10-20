# Zalt Text to Speech Voice Dictation for VRChat

Chrome extension for one-button dictation that fills Zalt Text to Speech and clicks its **Generate Speech** button when speech pauses. Changes are kept on the development branch; do not merge into `main` unless desired.

Branch: https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation

## Setup

1. Download ZIP from **Code → Download ZIP** on the branch page and extract it.
2. Open `chrome://extensions`, enable Developer mode, then reload the unpacked extension or load the extracted folder.
3. Open the extension dashboard and click **Open Zalt Text to Speech**.
4. Choose your preferred voice and keep the Zalt Text to Speech tab open.
5. Return to the dashboard, click **Start dictation + Generate**, and allow microphone access.
6. Speak naturally. After about three seconds of silence, the extension fills the transcript into the page and clicks **Generate Speech**.
7. Route the generated audio through your existing Voicemeeter setup into VRChat.

## Important

- This version automates the Zalt Text to Speech website UI and does not call its TTS API or require an API key.
- The public page currently indicates a the first visit may take longer while the speech model downloads locally; wait until Generate Speech is enabled.
- Overlapping submissions are queued, and an identical transcript repeated within five seconds is ignored to prevent duplicate conversions.\n- Website layout changes may require selector updates.
- No live test has been run against a signed-in browser session or VRChat.
