# ChatGPT Dictation EXE (Windows UI Automation)

Standalone Windows app: mic transcription + direct desktop automation. No Tampermonkey and no Chrome extension required for the automation path.

## Test it
1. Download **ChatGPTDictation.exe** from the GitHub Actions artifact.
2. Run it and allow microphone access.
3. Open ChatGPT in Chrome. Click the ChatGPT composer once so it is visible.
4. Leave the checkbox **Send transcript to ChatGPT + Read Aloud** checked, then press **START LISTENING**.
5. Speak. The EXE attempts to focus ChatGPT's accessible composer, paste the recognized phrase, press Enter, then invoke a Read Aloud button after 6.5 seconds.
6. Test the local bridge independently at http://127.0.0.1:8765/health and http://127.0.0.1:8765/next.

## Local API
- GET /health -> service status JSON
- GET /next -> consumes one queued transcript, or {"text":null}

## Notes / limitations
- Uses Windows System.Speech (English US), no Python or separate model download.
- Chrome and ChatGPT must be open and accessible. UI Automation accessibility names can vary; if composer/button lookup fails, the app reports it in its status.
- Read Aloud timing is currently a simple 6.5-second delay, not a reliable response-completion detector.
- Windows UI automation may require Chrome to be foregrounded/unlocked.