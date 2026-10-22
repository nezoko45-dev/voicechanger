# Fast Dictation + Browser Voice Clone Studio

A Chrome Manifest V3 extension with two tools:

- Hands-free dictation on [TTSLab.dev](https://ttslab.dev/) and [Fish Audio](https://fish.audio/).
- A browser-only voice-cloning studio that uses WebGPU for text-to-speech in a selected reference voice and local speech recognition for dictation.

## Build the extension

The voice studio bundles its JavaScript model runtime locally so the extension does not load executable code from a CDN.

Requirements: Node.js 20+ and a recent Chrome or Edge build with WebGPU support.

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

## Use Browser Voice Clone Studio

1. Click the extension icon, then **Open Voice Clone Studio**.
2. Click **Load WebGPU models**. On first use, the Chatterbox voice model downloads about 1.5 GB and is cached by the browser. Allow time for model download and GPU session initialization.
3. Choose a clean WAV reference recording, ideally 5–15 seconds long, from a voice you own or have permission to use. Click **Use this reference voice**.
4. Click **Start local dictation**, speak, then click **Stop dictation**. Whisper runs in-browser on WebGPU and inserts the recognized text into the editor. You can edit or type text directly instead.
5. Click **Synthesize speech**. The generated audio appears as a playable WAV clip with a **Download WAV** link.

### Model and browser notes

- Voice cloning uses [VoxShot](https://github.com/m96-chan/voxshot) with the Chatterbox ONNX model through Transformers.js. Speech generation and the local Whisper dictation model run on WebGPU; the studio refuses to start if WebGPU is unavailable.
- The current Chatterbox checkpoint is English-focused. Other languages may not synthesize correctly.
- First-time model downloads are large and require an internet connection. Model weights are cached by the browser after download. Subsequent inference runs locally.
- Reference audio and synthesis text are passed to local in-browser model code, not to a voice-cloning API. Model files are downloaded from Hugging Face.
- Voice cloning is resource-intensive; GPU memory, browser version, graphics drivers, and hardware affect performance.
- Use reference recordings only when you have permission to use that voice. Do not use this tool for impersonation or deception.

## Implementation notes

- MV3 extension source files are in the repository root.
- `npm run build` copies the extension into `dist/` and bundles `voice-clone.js` with the model runtime.
- The previous Python/VoiceClonNX helper is no longer used by the WebGPU studio.
- All changes for this work are on `feature/ttslab-fast-dictation`; `main` is not modified.
