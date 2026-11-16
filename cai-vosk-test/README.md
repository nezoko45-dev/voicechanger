# Vosk quick microphone test

This is a focused test of offline speech recognition before wiring it into Character.AI.

## Run

1. Install the .NET 8 SDK.
2. Run `setup-model.bat` once (downloads the small English Vosk model; unzip is automatic).
3. Run `run.bat`.
4. Speak into the default Windows microphone. Recognized complete phrases print as they arrive.

No Whisper and no Chrome speech service. Model initialization happens once at startup; the small model is roughly 50 MB.

If recognition is poor, check Windows Settings → System → Sound → Input and select the intended microphone.
