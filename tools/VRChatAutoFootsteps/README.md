# VRChat Auto Footsteps

A small Windows app that loops a chosen WAV file while the user holds movement keys in VRChat PC desktop mode.

## Current behavior

- Watches W/A/S/D and arrow keys while the VRChat window is focused.
- Starts the chosen WAV loop while a movement key is down.
- Stops playback when movement keys are released or VRChat loses focus.
- Converts selected audio to standard 44.1 kHz, 16-bit PCM WAV automatically, including WAV files with other encodings.
- Accepts common Windows Media Foundation-supported inputs such as WAV, MP3, M4A, AAC, and WMA.
- Saves converted files under `%LOCALAPPDATA%\\VRChatAutoFootsteps\\Converted`.
- Lets you choose a Windows playback device and adjust volume.
- Designed to route audio to a virtual cable or Voicemeeter playback input.

**Important limitation:** This first version detects keyboard movement input, not the avatar's actual position or speed. It won't detect movement driven by external controllers, tracking, or other software. VRChat does not automatically expose every avatar parameter as outbound OSC data, so actual avatar-speed detection requires a separately configured data source.

## Route audio into VRChat

1. Install/use your preferred virtual audio cable or Voicemeeter Banana.
2. In this app, select the playback endpoint that feeds your virtual microphone path (for example, the virtual cable's playback input).
3. In Voicemeeter, route that virtual input strip to the bus/device you use as your VRChat microphone.
4. In VRChat, select the corresponding Voicemeeter virtual output as the microphone.
5. Choose a short footsteps sound with a clean loop point (the app converts it to standard WAV), start the app, and keep VRChat focused while moving.

Test the routing with a friend or a private instance before using it publicly. Keep the volume low at first.

## Build the standalone EXE

The GitHub Actions workflow publishes a self-contained Windows x64 executable. It does not require Python or a separately installed .NET runtime.

The build artifact is named `VRChat-Auto-Footsteps-win-x64`.
