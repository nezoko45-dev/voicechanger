# Notepad Voice Reader

Dictate with Chrome Speech Recognition, paste each completed sentence into the **actual Windows Notepad app**, and read each sentence aloud with a selectable Chrome/Windows browser voice.

## Setup

1. Download this folder from GitHub (or download the repository ZIP).
2. In File Explorer, open the folder and right-click `bridge.ps1` → **Run with PowerShell**. Leave its window open. It starts a local-only bridge on `127.0.0.1:8765` and opens Notepad if needed.
3. Open `index.html` in desktop Chrome.
4. Click **Start dictation** and allow microphone access.
5. Select a voice from **Read-aloud voice**. If available, choose an English (United Kingdom) voice; voice names depend on Windows/Chrome installed voices.
6. Speak complete sentences. Sentences ending in a period, question mark, or exclamation mark are sent to Notepad and spoken automatically.

## Notes

- Stop dictation to flush any unfinished final phrase.
- Chrome speech recognition may use an online recognition service depending on browser configuration.
- This bridge listens only on localhost. Keep the PowerShell window open during use.
- Notepad must be available on the desktop and not blocked by a modal dialog. The bridge activates Notepad and pastes each sentence on its own line.
- The read-aloud voice is browser/system speech synthesis, not a separately generated audio file.
