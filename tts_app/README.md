# Native Mic → Whisper → WAV TTS app

This is a Windows-native, no-Python host for a local speech pipeline.

```text
microphone -> Whisper DLL -> text -> TTS DLL (reference WAV) -> Windows output / VRChat
```

## DLL contract

The host deliberately uses small C ABI adapters so the actual model DLLs can remain untouched.

### Whisper DLL
Expected exports:
- `whisper_init(const char* model_path)` -> opaque handle
- `whisper_transcribe(handle, const float* pcm, int samples, char* text, int text_capacity)` -> 0 on success
- `whisper_free(handle)`

### TTS DLL
Expected exports:
- `tts_init()` -> opaque handle
- `tts_clone_reference(handle, const float* mono, int samples, int sample_rate)` -> 0 on success
- `tts_synthesize(handle, const char* text, float** pcm, int* samples, int* sample_rate)` -> 0 on success
- `tts_free_audio(handle, float* pcm)`
- `tts_free(handle)`

The host checks exports at startup and reports exactly which one is missing. It does not modify or replace the DLLs.

Put the DLLs beside `tts_app.exe`:
- `whisper.dll`
- `tts.dll`

Put the Whisper model at `models/whisper.bin` (or pass another path in the launcher).

The reference WAV is selected from the UI and is used once to initialize the TTS voice.
