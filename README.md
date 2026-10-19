# Inworld AI Voice Dictation

A Chrome/Chromium Manifest V3 extension that transcribes speech in a separate extension side panel and sends each phrase to an Inworld AI text-to-speech page. This separation keeps the dictation interface out of the Inworld page, so it is less likely to freeze when that page is backgrounded.

## Install / update

1. Open the [extension branch on GitHub](https://github.com/nezoko45-dev/voicechanger/tree/rebuild/uberduck-voice-dictation) and download the repository ZIP, or update your existing local repository checkout to this branch.
2. Open `chrome://extensions` in Chrome or a Chromium-based browser.
3. Enable **Developer mode**.
4. If you already loaded this extension, click **Reload**. If you are loading it for the first time, choose **Load unpacked** and select the repository folder.
5. Open your Inworld AI TTS page and refresh it.
6. Click the extension icon, then **Open dictation panel**.
7. In the side panel, click **Start dictation** and allow microphone access.
8. Keep the side panel open, then switch to VRChat. After about 3 seconds of silence, the side panel sends the phrase to the Inworld tab and asks it to check for an enabled Generate button once per second and click it once for that phrase.

## Important background-tab setting

Chrome can throttle background tabs, and an extension cannot force a page to execute immediately while Chrome is throttling it. In Chrome, open **Settings → Performance** and add your Inworld site to the list of sites that are always kept active, if that option is available in your version. Keep the Inworld tab open while playing.

## Notes

- Uses the browser's Web Speech API for speech-to-text; browser support and microphone permissions apply.
- The extension runs on `https://inworld.ai` and its HTTPS subdomains.
- Dictation runs in the extension side panel, not inside the Inworld page. The Inworld content script only inserts the text and clicks Generate.
- The Generate button is checked once per second while the page updates, and clicked only once per phrase. Auto-generation has a 12-second cooldown to reduce accidental rapid repeat generation. There is no tab-focus restriction in the content script, but Chrome may still throttle background tabs.
- Inworld may change its page layout. If the side panel reports that it cannot send a transcript, reload the extension and refresh the Inworld tab. If it reports that the text box or Generate button was not found, the page selectors may need updating.
- This change has not been live-tested against your exact Inworld page. Background throttling may still delay the actual click, which is why the always-active site setting is recommended.
