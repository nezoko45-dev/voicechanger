# ChatGPT Voice Dictation

A minimal Chrome/Chromium Manifest V3 extension that continuously listens to your speech, sends recognized words to ChatGPT after a short pause, then clicks **Read Aloud** on ChatGPT's reply when the response has finished.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or a Chromium-based browser.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this repository folder.
5. Open [ChatGPT](https://chatgpt.com/) and reload the page.
6. Click **Start continuous dictation** on the floating panel and allow microphone access if prompted.
7. Speak naturally for as long as you like. The extension keeps collecting words across pauses. When you click **Stop continuous dictation**, it sends the complete transcript as one ChatGPT message. When ChatGPT finishes responding, it tries to click **Read Aloud** on the reply.

## Notes

- Uses the browser's Web Speech API to transcribe speech into text.
- Speech recognition availability depends on browser support and microphone permissions.
- Recognition restarts if the browser ends the session, so dictation can continue across multiple sentences.
- The floating checkbox and extension popup toggle automatic sending and Read Aloud when you stop dictation. When disabled, dictated text is added to the composer without automatically sending.
- ChatGPT may change its page markup. If the message box, Send button, or Read Aloud control cannot be detected, the floating status label may explain what happened.
- Automatic Read Aloud depends on ChatGPT exposing a Read Aloud control for the latest assistant response. The extension has not been live-tested against every current ChatGPT interface.
- The extension only runs on `chatgpt.com` and `chat.openai.com`.
