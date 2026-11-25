# Edge Female Voice Studio

Browser-based live microphone voice changer for Microsoft Edge using the official Signalsmith Stretch Web Audio WASM/AudioWorklet build.

## Run
Open the GitHub Pages URL over HTTPS in Microsoft Edge, allow microphone access, choose your microphone and output, then Start microphone. For VRChat, select VoiceMeeter Output as the mic after routing this page's output into VoiceMeeter Input.

## Notes
- Audio stays in the browser tab; there is no upload or server conversion.
- Signalsmith Stretch handles pitch and formant shifting. The page uses the native Web Audio graph for routing and EQ.
- Tone.js is intentionally not in the real-time signal path: Signalsmith Stretch requires a native AudioContext, and wrapping it in Tone.js' context abstraction can cause compatibility problems. Tone.js is not required for this effect chain.
- Presets are starting points, not a guarantee of a naturally female voice. Adjust pitch and formant to suit the input voice.
- Keep the tab open and active enough for Edge to process audio. Browser scheduling/background throttling can affect real-time performance.
