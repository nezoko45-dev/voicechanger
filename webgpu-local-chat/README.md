# VoiceChanger — WebGPU Local AI Chat

A static GitHub Pages chat page powered by WebLLM. Inference runs in the browser using WebGPU; no API key or hosted inference service is used.

## Use

Open the `webgpu-local-chat/` page on the VoiceChanger GitHub Pages site in a current Chrome or Edge browser with WebGPU enabled. Choose a small model, click **Load model**, wait for the initial model download, then chat.

The WebLLM JavaScript package is imported from esm.run. Model weights are downloaded from the configured model hosts and cached by the browser. The first download can be large. Keep the tab open while loading or generating.

## Notes

- Requires WebGPU support and enough GPU memory for the selected model.
- The page lists smaller models from WebLLM's current prebuilt model registry where possible.
- This is a standalone folder and does not modify the existing extension or voice conversion tools.
