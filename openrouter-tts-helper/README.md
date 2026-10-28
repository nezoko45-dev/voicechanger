# OpenRouter TTS Helper (Windows)

This helper lets the OpenRouter TTS Reader use your OpenRouter API key without putting the key into the browser page.

## Build/download the EXE

The workflow `.github/workflows/build-openrouter-tts-helper.yml` builds a self-contained Windows x64 executable.

1. Open the repository's **Actions** tab.
2. Choose **Build OpenRouter TTS helper** and run the workflow, or push a change to this feature branch to trigger it.
3. Open the successful workflow run and download artifact **OpenRouterTTSHelper-windows-x64**.
4. Extract the ZIP and run `OpenRouterTTSHelper.exe`.

## Use

1. Create/copy an API key at https://openrouter.ai/keys.
2. Run `OpenRouterTTSHelper.exe`; paste the key when prompted (typing is hidden) and press Enter.
3. Keep the helper window open.
4. Open the Voice Reader page, paste a ChatGPT reply, choose a model/voice, and press **Generate & Read Aloud**.

The helper listens only on `127.0.0.1:32146`, keeps the key in process memory, and forwards speech requests to `https://openrouter.ai/api/v1/audio/speech`. It does not save the key to disk. Closing the helper clears the key from its process memory.

The page uses the local helper endpoint `http://127.0.0.1:32146/api/speech`. This initial version reads pasted text; automatic cross-tab capture of ChatGPT replies is not included.
