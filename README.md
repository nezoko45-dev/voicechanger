# ElevenLabs Call Autoclicker for VRChat

Chrome extension that watches ElevenLabs pages for a visible, enabled **Start a call** button and clicks it once per appearance. It rearms after the button disappears, so it can click again when the button returns. Changes are kept on the development branch; do not merge into `main` unless desired.

Branch: https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation

## Setup

1. Download ZIP from **Code → Download ZIP** on the branch page and extract it.
2. Open `chrome://extensions`, enable Developer mode, and load the extracted folder or reload the unpacked extension.
3. Open the extension dashboard and click **Open ElevenLabs**.
4. Navigate to your agent page where **Start a call** appears.
5. Click **Start autoclicker** in the dashboard, then switch to VRChat.
6. When the button appears after a call ends, the content script attempts to click it once.

## Notes

- This automates the ElevenLabs page UI; it does not use an ElevenLabs API.
- Keep the ElevenLabs agent tab open. Chrome background throttling, iframe restrictions, page redesigns, and agent/session limits can prevent a restart.
- The monitor only clicks a visible, enabled button with the exact label **Start a call** and does not repeatedly click while the same button remains present.
- No live test has been run against a signed-in ElevenLabs session or VRChat.
