# OpenRouter TTS Reader — Native Windows EXE

This is a native .NET/WPF Windows app, not Electron and not a Chrome tab. It uses Windows speech recognition for microphone dictation and calls OpenRouter's audio-speech endpoint for TTS.

## Build / download

GitHub Actions builds a self-contained Windows x64 publish. Open the repository's **Actions** tab, choose **Build OpenRouter TTS Reader EXE**, open the successful run, and download the **OpenRouter-TTS-Reader-Windows-x64** artifact. Extract the ZIP and run `OpenRouterTtsReader.exe`. No separately installed .NET runtime is required.

## Requirements and notes

- Windows 10/11 x64.
- Internet connection and a valid OpenRouter API key for generated speech.
- A compatible Windows English speech-recognition engine and microphone permission for dictation. Availability varies by Windows language/voice configuration.
- The API key is held in memory only and is not written to a settings file.
- Generated MP3 audio is temporarily written to the Windows temp folder and deleted when the app closes.
- The app is not Electron and does not require Chrome to remain open. Dictation uses Windows' installed speech recognition engine; TTS generation still requires OpenRouter/network access.

## Troubleshooting

If dictation cannot start, check Windows Settings → Privacy & security → Microphone and enable microphone access for desktop apps. Also check that Windows has an English speech-recognition language/engine installed. If the selected model/voice is unavailable to your OpenRouter account, choose another supported model/voice.
