# VoiceChanger tools

This repository contains two separate unpacked Chrome extensions.

## Natural Girl Voice (Signalsmith Stretch)

A live microphone voice-effect extension using the official Signalsmith Stretch Web Audio/WASM release. Audio processing stays local.

1. Download the repository using **Code → Download ZIP**, then extract it.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `girl-voice` folder.
4. Click the extension icon, choose the pitch and formant settings, then click **Start voice** and allow microphone access.

The default preset starts at +4 semitones pitch and +2 semitones formant shift. Tune it to your own voice; results vary. Use headphones.

**Important limitation:** This previews the processed microphone through browser audio output. Chrome extensions cannot create a system-wide virtual microphone by themselves, so routing to Discord or other desktop apps requires a virtual audio cable/device.

See [girl-voice/README.md](girl-voice/README.md) for details.

## Fish Audio Call Again

The original helper extension is in the `extension` folder. Load that folder in `chrome://extensions` to use the Fish Audio **Call again** automation.

## Privacy

The Natural Girl Voice extension does not upload or record microphone audio. It only requests microphone access after you click **Start voice** and stops the microphone when you click **Stop** or close the popup.
