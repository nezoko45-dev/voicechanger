# ChatGPT Echo Guard

A small Chrome Manifest V3 extension for a voice-repeater workflow. When armed, it watches ChatGPT's visible conversation text and supported Voice Mode transcript/caption elements. If the assistant's settled transcript is not an exact text match for the latest user utterance, it attempts to open a new chat and restart Voice Mode.

## Install or update in Chrome

1. Open or download the `chatgpt-echo-guard` folder.
2. Visit `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this folder, or click **Reload** if already installed.
5. Refresh `https://chatgpt.com`.
6. Click the extension icon and enable **Arm echo guard**.

## Voice Mode detection

- It first checks normal ChatGPT user/assistant message elements.
- If those are absent, it checks visible transcript/caption/live-region elements whose DOM metadata identifies them as the user or assistant.
- Open DevTools Console on ChatGPT to see `[Echo Guard]` diagnostics, including whether the source was normal chat messages or Voice Mode transcript nodes.
- It does not record microphone audio or independently transcribe sound. If ChatGPT does not expose Voice Mode words in readable, speaker-labeled page elements, the extension cannot safely compare them; the console will show that no usable transcript source was found.
- ChatGPT's page structure can change. New Chat detection and automatic Voice Mode restart are best-effort and may require updates if the site changes.
- Exact text matching can flag speech-recognition differences, punctuation-independent wording differences are normalized, but actual word changes still count as a mismatch. Keep the guard disarmed during ordinary conversations.

## Troubleshooting

If it says Voice Mode is detected but the transcript source is `none`, open DevTools Console, reproduce one short Voice Mode exchange, and share the `[Echo Guard]` diagnostic output. That will show whether ChatGPT exposes transcript elements that need a site-specific selector update.
