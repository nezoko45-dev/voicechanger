# Rust WAV Reference Voice Changer

A native Rust desktop control panel for live WAV-reference voice conversion. This first GUI milestone controls the pure-Rust [babiniku.rs](https://github.com/m96-chan/babiniku.rs) engine. Seed-VC is intentionally not enabled.

## Current scope

- Pick a target-speaker WAV.
- Configure microphone and output device names.
- Launch and stop the Babiniku engine.
- Route output through VoiceMeeter Input or VB-CABLE.

**Important:** This GUI is a controller, not a voice-conversion engine by itself. It expects a separately built `babiniku.exe` next to the GUI (or a full path entered in the app). It does not yet enumerate audio devices or package model weights. The GUI's Start button passes the selected settings to the engine CLI.

## Windows engine setup

1. Install [Rust stable](https://rustup.rs/) and Visual Studio Build Tools with **Desktop development with C++**.
2. In PowerShell, install the engine with the WAV voice-print feature:

   ```powershell
   # The package workflow pins ONNX Runtime to the API version used by Babiniku:
git clone https://github.com/m96-chan/babiniku.rs
cd babiniku.rs
(Get-Content Cargo.toml -Raw).Replace('ort = "2.0.0-rc.10"', 'ort = "=2.0.0-rc.10"') | Set-Content Cargo.toml
cargo build --release --manifest-path crates/babiniku/Cargo.toml --features wavlm
# Engine: target/release/babiniku.exe
   ```

   If Cargo's bin folder is not on PATH, copy the installed `babiniku.exe` next to this GUI or enter its full path.
3. Download/configure the engine checkpoints using the [MeanVC guide](https://github.com/m96-chan/babiniku.rs/blob/main/docs/meanvc.md). The default MeanVC model is Mandarin-trained; English speech quality may be limited. X-VC is multilingual but CPU real-time performance is not guaranteed.
4. Install VB-CABLE if needed, or use VoiceMeeter Banana. For VoiceMeeter, set output to `VoiceMeeter Input` and choose `VoiceMeeter Output` as the microphone in VRChat.

## Build this GUI

Run `build.bat`. It builds a Windows release executable into `target\\release\\rust-wav-reference-voicechanger.exe`.

## Troubleshooting

- If Start reports that Babiniku cannot launch, place `babiniku.exe` beside this GUI or enter its full path.
- If the engine exits immediately, verify the exact device names and checkpoint setup.
- The first engine launch may take time while it loads model files.
- Windows audio routing depends on a loopback driver such as VoiceMeeter or VB-CABLE. Babiniku's Windows routing has CI/build verification; live hardware reports are still being gathered upstream.
