# CAI Voice Automation (Windows)

## Build
GitHub Actions builds a self-contained Windows x64 executable:
- Actions → **Build CAI Voice Automation EXE**
- Download artifact **CaiVoiceAutomation-win-x64**

## Run
1. Start Chrome with remote debugging enabled (port 9222), e.g.:
   `chrome.exe --remote-debugging-port=9222`
2. Open Character.AI in that Chrome instance.
3. Run `CaiVoiceAutomation.exe`.
4. Open `http://127.0.0.1:8765` in Chrome to start the localhost Web Speech recognition bridge. Allow microphone access.
5. Keep the bridge tab open. The app listens for recognized speech and monitors Character.AI audio in the debug tab.

Voice button handling is based on a button containing an SVG and a voice/call/microphone label. Audio monitoring currently uses HTML audio/video elements exposed in the Character.AI tab.
