# NaturalReader Voice Dictator

A small Chrome Manifest V3 extension for NaturalReader Online Reader. It listens to microphone speech, writes recognized words into the text editor, and optionally clicks Play after a short pause.

## Install

1. Download or clone this repository and open the `naturalreader-voice-dictator` folder.
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this folder.
5. Open [NaturalReader Online Reader](https://www.naturalreaders.com/online/), then open its **Type or Paste Text** editor.
6. Use the floating **Voice Dictator** panel and allow microphone access.

## Options

- **Clear text field when starting**: checked by default, so each new dictation starts fresh.
- **Auto-press Play after a pause**: checked by default; waits about 1.4 seconds after recognized speech and attempts to click the reader's Play control.
- **Stop** ends microphone dictation.

## Notes

- Uses Chrome's built-in Web Speech recognition API; recognition availability and processing depend on Chrome and its speech service.
- The extension does not upload audio to a separate server of its own.
- NaturalReader's interface can change. If it can't confidently identify the text field or Play control, it reports that in the panel instead of clicking an unrelated control.
