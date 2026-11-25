# Edge Female Voice Studio

Browser-based live microphone voice changer for Microsoft Edge using Tone.js PitchShift and native Web Audio EQ.

## Run
Open the GitHub Pages URL over HTTPS in Microsoft Edge, allow microphone access, choose your microphone and output, then press **Start microphone**. For VRChat, route the page's output into VoiceMeeter Input and select VoiceMeeter Output as the VRChat microphone.

## Notes
- Audio is processed locally in the browser tab; there is no upload or server conversion.
- Tone.js PitchShift provides pitch shifting. Native Web Audio filters add brightness, warmth, and dynamics control.
- Tone.js PitchShift does not independently shift vocal formants, so this cannot guarantee a naturally female voice. Use moderate pitch values to avoid a cartoon-like sound.
- Keep the tab open while using the converted microphone. Browser scheduling and system load can affect real-time performance.
