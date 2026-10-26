# NaturalReader Auto Voice Caption

Chrome extension for https://www.naturalreaders.com/online/

## What it does
- Watches the NaturalReader text editor for typed or dictated text.
- After a configurable pause (default 2.2 seconds), clicks the page's Play button.
- Waits for playback to finish, then clears the editor so you can enter or dictate the next text.
- Includes an Auto-play toggle, pause duration slider, and Play now button.
- If it cannot identify Play, it keeps your text rather than deleting it.

## Install
1. Download this repository branch as a ZIP and extract it.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked** and select `extensions/naturalreader-voice-caption`.
5. Open or refresh NaturalReader Online.

## Notes
NaturalReader's page structure can change. Test with a short sentence first. Auto-clear occurs after estimated playback completion if the page does not expose a detectable audio element; the extension uses NaturalReader's own clear control when it can find one.
