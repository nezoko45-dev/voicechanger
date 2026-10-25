# Dopple Voice Caption

Chrome extension for reading Dopple.ai character replies aloud, with visible captions and a selectable English browser voice. The default voice picker prefers female-sounding English voices when the operating system/browser provides them; available voices vary by computer.

## Install
1. Download this folder or the repository branch.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Choose **Load unpacked** and select `extensions/dopple-voice-caption`.
4. Open a Dopple.ai chat and refresh the tab.
5. Use the floating **Dopple Voice Caption** panel. Press **Test voice** first, then **Read latest**.

## Features
- Auto-read newly appearing character replies (toggle it off if you prefer manual reading).
- Female-leaning English voice selection when available; never hardcodes David.
- Captions displayed while the reply is being spoken.
- Test voice with editable custom test caption text.
- Read latest reply, stop speech, and speak selected text.
- Uses Chrome's built-in Speech Synthesis API; no Python, server, or API key.

## Troubleshooting
- After installation/reload, refresh the Dopple tab so the content script loads.
- Click **Test voice** once. If silent, check the Windows output device and Chrome tab/site volume, then choose another voice in the on-page selector.
- Voice availability depends on installed Windows/Chrome voices. If no female voice is installed, the browser's available English voice is used.
- If auto-read picks up the wrong text due to a Dopple layout change, turn it off and use **Read latest** or select text and choose **Speak selected text**.
