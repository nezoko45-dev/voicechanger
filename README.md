# Unity VoiceChanger + Seed-VC

This project uses **Seed-VC** as the local neural voice-conversion engine.

Seed-VC provides zero-shot realtime voice conversion from a short reference recording, so an RVC model does not have to be trained first. The project is local after setup and does not use Deepgram credits.

## Setup

1. Install Python 3.10.x and Git for Windows.
2. Run `setup_seedvc.bat`.
3. Open the Unity project with Unity 6000.2.6f2.
4. Open `Assets/Scenes/Main.unity`.
5. Enter Play mode.
6. Press **CHOOSE REFERENCE WAV**.
7. Press **START VOICE ENGINE**.
8. In the Seed-VC window, choose your microphone and output device and start Voice Conversion.
9. For VRChat, route Seed-VC output to VB-CABLE or Voicemeeter and choose that virtual microphone in VRChat.

## Starting realtime settings

- Diffusion steps: 6
- CFG rate: 0.7
- Block time: 0.18 seconds
- Crossfade: 0.04 seconds
- Extra left context: 2.5 seconds
- Extra right context: 0.02 seconds

If inference takes longer than the selected block time, increase block time. A GPU is strongly recommended for realtime conversion.

## What changed

The Unity MonoBehaviour is now a controller for a real voice-conversion engine instead of simply passing microphone audio through or playing a reference WAV. It provides a scrollable control panel, reference WAV selection, realtime performance controls, and starts the local Seed-VC engine.

The Seed-VC engine owns the realtime neural audio device stream. This is deliberate: its realtime implementation already handles microphone/output devices, reference audio, chunking, crossfading, and model inference.

## VRChat audio path

Use:

Microphone -> Seed-VC -> VB-CABLE/Voicemeeter -> VRChat microphone

This keeps the converted stream on Windows and avoids cloud speech services.

Seed-VC is an external open-source dependency. Its source and license remain governed by its upstream repository.
