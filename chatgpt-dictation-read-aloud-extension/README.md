# ChatGPT Dictation + Read Aloud Loop

A small Manifest V3 Chrome extension for ChatGPT. It uses the browser's Web Speech Recognition API to transcribe microphone speech, waits for a pause, puts the words in ChatGPT's composer, sends them, waits for the assistant reply to settle, then clicks **Read aloud**.

## Install
1. Download or clone this repository and open the `chatgpt-dictation-read-aloud-extension` folder.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select that folder.
5. Open or reload `https://chatgpt.com`.
6. Click the extension icon, choose a silence delay, and click **Start loop**.
7. Allow microphone access if Chrome asks.

## Behavior
- The browser's speech recognizer supplies the transcript; no local server or Python is required.
- After the configured quiet period, the extension sends the recognized phrase.
- It waits for the newest assistant message to stop changing, clicks **Read aloud**, then restarts recognition after audio playback ends or a duration estimate expires.
- Click **Stop** in the popup to stop the loop.

## Notes
- Chrome's built-in speech recognition may use Google's speech service; it is not guaranteed to be offline.
- Use headphones to reduce the chance of ChatGPT's spoken reply being picked up as your own microphone input.
- ChatGPT's DOM and accessible button labels can change. If a control isn't found, reload ChatGPT and the extension, then check the on-page status pill.
- Test with short messages first. Auto-send and auto-read-aloud are intended to run only on the ChatGPT tab where you start the extension.
