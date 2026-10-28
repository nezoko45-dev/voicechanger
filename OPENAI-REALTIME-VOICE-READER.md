# OpenAI Realtime Voice Reader

This GitHub Pages app uses OpenAI's Realtime API for speech-to-speech conversation. It does not automate ChatGPT webpage buttons or use browser text-to-speech.

## Setup without Vercel or Netlify

Use the local Windows token helper:

1. Open the repository's **Actions** tab and select **Build local Realtime token helper**.
2. Download the successful run's `VoiceReaderLocalTokenHelper-windows-x64` artifact and extract it.
3. Run `VoiceReaderLocalTokenHelper.exe`, paste your OpenAI API key into its console prompt, and press Enter. The key is kept in memory by the helper and is not saved by the app.
4. Keep the helper window open. It listens only on `127.0.0.1:32145`.
5. Open the Voice Reader GitHub Pages page and click **Start voice conversation**. The page uses `http://127.0.0.1:32145/api/session` automatically.
6. Allow microphone access.

No Vercel or Netlify endpoint is needed. See `local-realtime-token-helper/README.md` for troubleshooting.

## Security and billing

The helper binds only to loopback and accepts browser requests from the official GitHub Pages origin. It does not save your key to disk or browser local storage. The console prompt is visible while typing, so do not screen-share it. Closing the helper clears the key from its process memory. Use a dedicated OpenAI API key with usage limits. OpenAI API usage is billed separately from a ChatGPT subscription.

## Voice

The API is configured to use the `gpt-realtime-2.1` model and the `marin` voice. API voices are not guaranteed to be identical to the voice selected in ChatGPT Voice Mode.
