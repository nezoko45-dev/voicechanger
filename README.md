# ElevenLabs Voice Dictation for VRChat

A Chrome/Chromium Manifest V3 extension that transcribes speech in a separate extension side panel and queues phrases for the ElevenLabs Text to Speech website. It is designed so you can switch to VRChat while the ElevenLabs tab remains open.

## Install / update

1. Open the [extension branch on GitHub](https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation) and download the repository ZIP, or update your local checkout to this branch.
2. Open `chrome://extensions` in Chrome or a Chromium-based browser.
3. Enable **Developer mode**.
4. If the extension is already loaded, click **Reload**. For a first install, choose **Load unpacked** and select the repository folder.
5. Open and sign in to the [ElevenLabs Text to Speech page](https://elevenlabs.io/app/speech-synthesis/text-to-speech), then refresh it.
6. Click the extension icon and choose **Open dictation panel**.
7. Click **Start dictation** and allow microphone access.
8. Keep the side panel open and switch to VRChat. After about 3 seconds of silence, the extension queues the phrase, fills the ElevenLabs text field, and clicks Generate when the page indicates it is ready.

## Background tab

Chrome can throttle background tabs. In Chrome Settings → Performance, add `elevenlabs.io` to the always-active sites list if that setting is available in your version. Keep the ElevenLabs tab open while playing.

## How phrase handling works

- Speech recognition runs in the side panel using the browser Web Speech API.
- Phrases are queued and submitted in order; the extension no longer applies its old fixed 12-second cooldown.
- The content script waits for a visible text field and Generate button, checks whether the button is enabled, and clicks once per phrase.
- The extension waits for the generator UI to indicate completion where possible before processing the next queued phrase.
- UI automation can break if ElevenLabs changes its layout or button labels. If the extension reports that it cannot find a text box or Generate button, refresh the ElevenLabs tab and check for site changes.
- Generated audio playback/routing is not controlled by this extension. Keep using your existing audio-routing setup for VRChat.
- Each generation uses your ElevenLabs account's normal quota/credits and is subject to account limits. See the [official Text to Speech guide](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech).

This code update has not been live-tested against your signed-in ElevenLabs session.