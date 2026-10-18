# Natural Girl Voice (Signalsmith Stretch)

A Manifest V3 Chrome extension that processes microphone audio locally using the official Signalsmith Stretch Web Audio/WASM release.

## Install

1. Download this repository as a ZIP and extract it.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `girl-voice` folder.
5. Open the extension popup, click **Start voice**, and allow microphone access.

## Controls

- **Voice pitch:** starts at +4 semitones.
- **Formant shift:** starts at +2 semitones to brighten the vocal resonance as well as raise pitch.
- **Stop:** shuts down the microphone and audio context.

This is a starting preset, not a guarantee of a specific gender perception. Voices differ; try pitch +3 to +5 and formant +1 to +3 for a subtler result.

## Important limitation

This extension monitors the processed microphone audio through the browser's audio output. A regular Chrome extension cannot expose its processed stream as a system-wide microphone device. To use it in desktop apps such as Discord, a virtual audio cable/device and routing configuration are needed. Use headphones to avoid feedback.

## Privacy

Microphone audio is processed locally and is not uploaded or recorded. The microphone is only active after **Start voice** and stops when you press **Stop** or close the popup.

## Third-party library

The bundled `SignalsmithStretch.mjs` is from the official Signalsmith-Audio/signalsmith-stretch Web Audio release and is licensed under the upstream MIT license. See `SIGNALSMITH-LICENSE.txt`.
