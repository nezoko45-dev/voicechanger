# Audio Watchdog — Auto Restart (Chrome extension)

A small Manifest V3 extension that watches standard HTML `<audio>` and `<video>` elements. If an element says it is playing, has enough data to play, and its playback position does not advance for the configured number of seconds, the extension pauses it and calls play() again.

## Install in Chrome (Windows)

1. Open this folder on GitHub and download the folder's files, or download the repository ZIP and extract it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the `audio-watchdog-extension` folder (the folder containing `manifest.json`).
5. Open the extension's puzzle-piece menu, pin **Audio Watchdog**, and use its popup to enable/disable protection and adjust the stall threshold.
6. Reload any tabs that were already open before installing the extension.

## Notes / limitations

- Default behavior: detect a stall after 8 seconds; wait at least 15 seconds between recovery attempts for the same player.
- It only attempts recovery when media is not paused or ended, is not seeking, has ready data, and has no media error.
- Browser autoplay restrictions, a disconnected stream, a site's own player logic, or a failed network request can prevent recovery.
- It can restart ordinary HTML audio/video. It cannot reliably detect silence in custom Web Audio players, and it does not click a website's own Stop/Play buttons.
- The content script runs on pages where Chrome allows extensions. Chrome internal pages and some protected pages cannot be controlled.
- This extension processes playback locally; it does not send page content or audio anywhere.
