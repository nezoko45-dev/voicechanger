# ElevenLabs Voice Dictation for VRChat

A Chrome/Chromium Manifest V3 extension that adds a floating dictation control to the ElevenLabs webpage and queues phrases for Text to Speech. The extension's side panel hosts speech recognition so it can continue while you switch to VRChat.

## Install or repair

**Latest branch:** https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation

1. Download the ZIP from the branch page above using **Code → Download ZIP**, then extract it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. If the existing extension is still blank, remove that extension from Chrome first. This removes only the browser-installed copy, not the repository files.
5. Click **Load unpacked** and select the extracted repository folder that directly contains `manifest.json`, `sidepanel.html`, and `sidepanel.js`. Do not select the ZIP or an outer folder that does not contain `manifest.json`.
6. Confirm the extension shows version **1.6.1** on `chrome://extensions`.
7. Click the extension icon and choose **Open dictation panel**. You should see **🎙 Start dictation** even before JavaScript initializes. If the script fails to load, the page now displays a diagnostic message.
8. Open and sign in to the [ElevenLabs Text to Speech page](https://elevenlabs.io/app/speech-synthesis/text-to-speech), then refresh that tab.
9. In the side panel, click **Start dictation** and allow microphone access. Speak a short phrase and pause. With auto-send enabled, the phrase is queued for ElevenLabs.
10. Keep the side panel open while playing VRChat. Use the floating button near the bottom of the ElevenLabs page to toggle dictation after the side panel has started it.

## Troubleshooting

- **Panel is completely blank:** Verify the installed version is 1.6.1. Remove the old installed copy and use **Load unpacked** on the extracted branch folder described above. The side panel HTML includes the Start button directly, so a fully blank page usually means Chrome is not loading the expected `sidepanel.html`.
- **A diagnostic error appears:** Open `chrome://extensions`, locate the extension, and click **Errors** if shown. The panel's visible message may identify a missing `sidepanel.js` file or an initialization issue.
- **Microphone permission denied:** Click Start dictation again after allowing microphone access for the extension page. Check Chrome's site/microphone permissions and confirm the intended input microphone is selected by the operating system.
- **Speech recognition is unsupported:** Use a current Chrome version (Chrome 116 or later is required for the side panel).
- **Transcript doesn't reach ElevenLabs:** Keep the ElevenLabs Text to Speech tab open and refresh it after updating the extension. Sign in, confirm the TTS page is loaded, and check whether the extension can find the text field and Generate button.
- **Chrome background throttling:** In Chrome Settings → Performance, add `elevenlabs.io` to the always-active sites list if available in your version.

## How phrase handling works

- Speech recognition runs in the extension side panel using the browser Web Speech API.
- Phrases are queued and submitted in order after a pause when auto-send is enabled.
- The content script locates the visible text field and Generate button, then submits one phrase at a time.
- ElevenLabs can change its interface, which may require updating the page automation.
- Audio playback and routing are not controlled by this extension. Continue using your existing audio-routing setup for VRChat.
- Generated audio uses your ElevenLabs account's normal quota/credits and is subject to account limits.

The update adds visible side-panel diagnostics and safer initialization handling. It has not been live-tested against your signed-in ElevenLabs session.
