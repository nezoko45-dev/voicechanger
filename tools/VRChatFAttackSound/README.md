# VRChat F/Q-Key Attack Sound

Standalone Windows x64 app that loops a chosen custom sound while either the **F or Q key is held**, and pauses/rewinds it as soon as both keys are released. Both keys are detected globally, so VRChat can remain the focused window.

## Use
1. Download the `VRChat-F-Attack-Sound-win-x64` artifact from the repository's GitHub Actions workflow.
2. Run `VRChatFAttackSound.exe`.
3. Choose your custom attack sound (WAV, MP3, M4A, AAC, or WMA where supported by Windows Media Foundation).
4. Select your playback device. For VRChat routing, choose the appropriate Voicemeeter or virtual-cable playback device.
5. Click **Start F/Q-key listener**, then hold **F or Q** to loop the same sound. Releasing both keys stops it.

Selected audio is normalized to 44.1 kHz, 16-bit PCM WAV under `%LOCALAPPDATA%\VRChatFAttackSound\Converted`. Use Stop to disable key detection. The app does not inject sound into VRChat directly; route the selected playback device to your VRChat microphone setup.

## Build
The GitHub Actions workflow publishes a self-contained Windows x64 single-file executable.
