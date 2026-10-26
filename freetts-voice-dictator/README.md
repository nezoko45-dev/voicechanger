# FreeTTS Voice Dictator

A small Chrome/Edge Manifest V3 extension for FreeTTS.

## Features
- Adds a floating Voice Dictator panel to FreeTTS.
- Uses Chrome's built-in Web Speech recognition to dictate microphone speech into the TTS text field.
- Clears old text when a new dictation session starts.
- Auto-generate is ON by default: after a short pause in speech, it searches real page buttons by accessible label/text (prioritizing **Convert to Speech**, then **Generate Speech**, then play/listen buttons) and clicks the best enabled match.
- Turn Auto-generate OFF to dictate only and click the page's blue play button yourself.

## Install
1. Download or clone this repository and open the `freetts-voice-dictator` folder.
2. In Chrome, open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this folder.
5. Open https://freetts.com/text-to-speech and click **Start dictation** in the floating panel.
6. Allow microphone access when Chrome asks.

## Notes
- Requires a Chromium desktop browser with Web Speech API support and an internet connection for browser speech recognition.
- The page's layout can change. If the TTS field or generate button is not detected, the panel will show a status message; you can turn off auto-generation and use the page's play button manually.
- Dictation starts only after you click the panel's Start button. It does not record continuously in the background.
