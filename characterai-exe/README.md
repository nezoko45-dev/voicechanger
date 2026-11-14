# Character.AI Dictation (Windows EXE)
Standalone app: Chrome native Web Speech Recognition on a localhost page; Windows desktop automation pastes final transcripts into Character.AI and sends them. No extension/Tampermonkey.

## Start
1. Download CharacterAIDictation.exe from Actions.
2. Run it; click START CONTINUOUS LISTENING.
3. Chrome opens http://127.0.0.1:8765/recognizer. Click Start Mic once and grant permission. Recognition auto-restarts continuously.
4. Open Character.AI chat in Chrome. Speak; final phrases are pasted and Enter sends them.
5. Keep EXE running while playing ChilloutVR.

Chrome's initial microphone start requires a click/permission. Background UI automation can be limited by Windows if Chrome is locked/inaccessible.

Local endpoints: /recognizer, /transcript, /health, /next, /stop.
