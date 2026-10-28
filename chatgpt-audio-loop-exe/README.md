# ChatGPT Audio Loop EXE

Windows x64 microphone-level monitor with Start/Stop controls. It monitors the default communications microphone and displays a live level meter. The loop attempts to use Windows UI Automation to click ChatGPT's Dictate, Send, and Read aloud buttons.

## Build / download
Run the **Build ChatGPT Audio Loop EXE** workflow in GitHub Actions, then download the `ChatGPT-Audio-Loop-Windows-x64` artifact.

## Use
1. Open ChatGPT in a normal Chrome or Edge window and sign in.
2. Run `ChatGptAudioLoop.exe`.
3. Press **Start loop**, allow microphone access in Windows if requested, then speak after the app reports dictation started.
4. Press **Stop** to stop monitoring.

## Limitations
- UI Automation exposes different names depending on browser and ChatGPT UI versions; if the Dictate, Send, or Read aloud button isn't exposed, the app reports that it could not find it.
- The initial implementation uses a short wait after sending as a proxy for response completion. It cannot reliably determine that a long response has finished, and should be tested before unattended use.
- Audio-level silence is only a heuristic and cannot distinguish silence from quiet speech. Adjust the threshold for your microphone.
