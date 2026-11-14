# ChatGPT Voice Dictator (fresh rebuild)

Chrome extension: mic speech → ChatGPT composer → Send → wait for response → Read Aloud → listen again.

## Install
1. Download this repository ZIP or clone it.
2. Chrome → chrome://extensions → enable Developer mode → Load unpacked → select this folder.
3. Open chatgpt.com and a conversation. Refresh the tab once after installing.
4. Click extension → **Start continuous loop** and allow microphone access.
5. Speak one sentence at a time. **Stop** ends the loop.

## Notes
- Uses Chrome's built-in SpeechRecognition (online recognition may require internet).
- Browser microphone permission is granted by the user.
- DOM selectors on ChatGPT can change; Read Aloud detection may need adjustment if the site updates.
- This extension automates the ChatGPT website UI, not Voice Mode.