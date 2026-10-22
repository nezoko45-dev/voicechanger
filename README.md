# Fast Dictation + Browser Kokoro TTS Studio

A Chrome Manifest V3 extension with two tools:

- Hands-free dictation on [TTSLab.dev](https://ttslab.dev/) and [Fish Audio](https://fish.audio/).
- A browser-only text-to-speech studio using Kokoro-82M and local speech recognition.

## Build the extension

The voice studio bundles its JavaScript model runtime locally so the extension does not load executable code from a CDN.

Requirements: Node.js 20+ and a recent Chrome or Edge browser. WebGPU is used when available; CPU/WASM is the fallback.

1. Download and extract this branch, or clone the repository and check out `feature/ttslab-fast-dictation`.
2. In the repository folder, run:
   ```sh
   npm install
   npm run build
   ```
3. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select the generated `dist/` folder.
4. After changes, run `npm run build` again and click **Reload** on the extension card.

Do not load the repository root as the unpacked extension: the root contains source files; `dist/` contains the bundled extension.

## Use dictation on TTSLab or Fish Audio

1. Open a TTSLab tool/model page with its **Stream** button, or Fish Audio’s text-to-speech page with its **Generate Speech** button. Keep it open in a tab.
2. Click the extension icon and choose **Start listening**. Allow microphone access.
3. Speak naturally. Interim transcript previews appear in the text field. After a brief pause, the extension attempts to click **Generate Speech**, **Stream**, or **Send**, depending on the page.
4. Keep talking for additional phrases; press **Stop listening** when finished.

Chrome speech recognition behavior and page selectors can vary by browser version and website updates.

## Use Browser Kokoro Studio

1. Click the extension icon, then **Open Voice Clone Studio**.
2. Click **Load Kokoro model**. The Kokoro-82M model downloads on first use and is cached by the browser.
3. Choose a built-in Kokoro voice preset.
4. Click **Start local dictation**, speak, then click **Stop dictation**. Whisper runs in-browser and inserts recognized text into the editor. You can also type text directly.
5. Click **Synthesize speech**. The generated audio appears as a playable WAV clip with a **Download WAV** link.

## Model and browser notes

- Speech synthesis uses [Kokoro-82M](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) through Transformers.js. VoxShot and Chatterbox have been removed from the voice studio.
- Kokoro uses its own built-in voice presets; it does **not** clone a voice from a reference WAV. This replaces the unstable VoxShot/Chatterbox path with reliable preset-voice TTS, rather than reference-audio cloning.
- First-time model downloads require an internet connection. After the model files are cached, inference runs locally in the browser.
- Dictation model files are downloaded from Hugging Face. Dictated text and generated speech are processed in-browser.
- Performance depends on browser version, device memory, GPU support, and hardware.
- Use voice features responsibly and do not use generated speech for impersonation or deception.

## Implementation notes

- MV3 extension source files are in the repository root.
- `npm run build` copies the extension into `dist/` and bundles `voice-clone.js` with the model runtime.
- The previous Python/VoiceClonNX helper is no longer used by the studio.
- All changes for this work are on `feature/ttslab-fast-dictation`; `main` is not modified.
