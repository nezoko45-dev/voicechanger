# ElevenLabs Voice Dictation for VRChat

A Chrome/Chromium Manifest V3 extension that adds a floating dictation control to ElevenLabs Text to Speech and queues phrases for generation. Speech recognition runs in the extension side panel so it can continue while you switch to VRChat.

**Branch:** https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation

## Clean install / repair

1. Download the ZIP from the branch page using **Code → Download ZIP**, then extract it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Remove the old installed copy if the side panel is blank. This does not delete the repository folder.
5. Click **Load unpacked** and choose the extracted folder that directly contains `manifest.json`, `sidepanel.html`, `sidepanel.js`, and `sidepanel-bootstrap.js`. Do not choose the ZIP or a parent folder.
6. Confirm the extension version is **1.6.2**.
7. Click the extension icon → **Open dictation panel**. The Start button is part of the panel HTML and should display even if JavaScript fails.
8. Open and sign in to [ElevenLabs Text to Speech](https://elevenlabs.io/app/speech-synthesis/text-to-speech), then refresh that tab.
9. Click **🎙 Start dictation** in the extension side panel and allow microphone access.
10. Speak a short phrase and pause. With auto-send enabled, the extension queues it for the ElevenLabs tab.
11. Keep the side panel open while switching to VRChat. The ElevenLabs TTS tab must remain open.

## Troubleshooting

- **Blank panel:** Confirm version 1.6.2. Remove the stale extension and load the extracted folder again. Since the button is literal HTML, a completely blank panel generally means Chrome is not loading this branch's `sidepanel.html`.
- **Panel script error:** The panel should display an error if `sidepanel.js` fails to load. On `chrome://extensions`, open the extension's **Errors** details if available.
- **Can't open side panel:** The popup now displays the failure message and offers **Open panel in a tab** as a diagnostic fallback. Chrome 116 or newer is required.
- **Microphone denied:** Allow microphone access for the extension page and check your OS input device.
- **Transcript not submitted:** Refresh the ElevenLabs TTS tab after installing the extension, confirm you're signed in, and check that the site still shows a text field and enabled Generate button.
- **Background throttling:** If available, add `elevenlabs.io` to Chrome Settings → Performance → always-active sites.

## Behavior and limitations

- Speech recognition uses the browser Web Speech API in the side panel. Chrome/browser speech recognition availability and microphone permissions still apply.
- Phrases are queued in order and submitted after a pause when auto-send is enabled.
- ElevenLabs can change its UI, which may require updating text-field and Generate-button detection.
- Audio playback and routing are not controlled by this extension. Continue using your existing audio-routing setup for VRChat.
- Generated audio uses your ElevenLabs account's normal quota/credits and is subject to account limits.

The branch includes visible panel diagnostics and popup fallback handling. It has not been live-tested against a signed-in ElevenLabs session.
