# CAI Voice Loop Chrome Extension

## What it does
1. Adds a small control panel to Character.AI.
2. Uses Chrome's built-in Web Speech recognition to capture a spoken utterance.
3. Inserts the recognized text into the chat and submits it with Enter.
4. Watches the response settle, then clicks the newest visible Play triangle matching the Character.AI SVG path.

## Install (unpacked)
1. Download this folder (or the repository ZIP) and extract it.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select `cai-voice-chrome-extension`.
5. Open/refresh Character.AI and click **🎙 Start** in the floating panel.
6. Allow microphone permission when Chrome asks.

## Notes / limitations
- Speech recognition uses Chrome's Web Speech service and generally needs internet; it is not offline Whisper.
- Character.AI's DOM changes periodically. If its composer or Play SVG changes, selectors may need updating.
- This extension only clicks reply audio playback; it does not convert your microphone voice live.
- Keep the Character.AI tab open and visible while testing.