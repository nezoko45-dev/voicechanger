# ChatGPT Echo Guard

A small Chrome Manifest V3 extension for the voice-repeater workflow. When armed, it watches ChatGPT's visible user/assistant message text. If Voice Mode appears active and the assistant's settled response does not closely resemble the latest user utterance, it clicks **New chat**.

## Install in Chrome

1. Open or download the `chatgpt-echo-guard` folder.
2. Visit `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this folder.
5. Open or refresh `https://chatgpt.com`.
6. Click the extension icon and enable **Arm echo guard** before starting the voice-repeater session.

## Notes

- It does not listen to or record microphone audio; it compares text that ChatGPT already displays in the page.
- ChatGPT's DOM and Voice Mode controls can change. Detection depends on visible transcript elements and recognizable Voice Mode button labels, so it may need selector updates if the site changes.
- Similarity is heuristic. Speech recognition errors or short phrases can cause false positives/negatives. Keep the guard disarmed during ordinary ChatGPT conversations.
- The popup includes a manual **Start fresh chat now** button for testing.
