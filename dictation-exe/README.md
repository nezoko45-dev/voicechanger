# ChatGPT Dictation EXE

A Windows desktop microphone dictation app for the ChatGPT Voice Dictator Chrome extension.

## Run
1. Download **ChatGPTDictation.exe** from the GitHub Actions artifact.
2. Run it and click **START LISTENING**. Windows may prompt for microphone access.
3. Open ChatGPT in Chrome and load this repository as an unpacked extension.
4. Click the extension's **START LOOP**. It checks the local EXE bridge for recognized phrases, sends them to ChatGPT, then clicks Read Aloud after the answer completes.
5. Click STOP in either app to stop the respective loop.

## Bridge
The EXE listens on `127.0.0.1:8765`:
- `GET /health` reports service status.
- `GET /next` returns one queued recognition as `{"text":"..." }` or `{"text":null}`.

Speech uses Windows' built-in System.Speech recognizer (English US), no Python or model download. The EXE is a separate mic listener; ChatGPT webpage automation remains in the Chrome extension.
