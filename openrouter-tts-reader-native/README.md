# Edge TTS Reader — Native Windows EXE

This is a native .NET/WPF Windows app, not Electron and not a Chrome tab. It uses Windows speech recognition for microphone dictation and calls Groq's audio-speech endpoint for TTS.

## Build / download

GitHub Actions builds a self-contained Windows x64 publish. Open the repository's **Actions** tab, choose **Build Edge TTS Reader EXE**, open the successful run, and download the **Edge-TTS-Reader-Windows-x64** artifact. Extract the ZIP and run `GroqTtsReader.exe`. No separately installed .NET runtime is required.

## Requirements and notes

- Windows 10/11 x64.
- Internet connection and a valid Groq API key for generated speech.
- A compatible Windows English speech-recognition engine and microphone permission for dictation. Availability varies by Windows language/voice configuration.
- The API key is held in memory only and is not written to a settings file.
- Generated MP3 audio is temporarily written to the Windows temp folder and deleted when the app closes.
- The app is not Electron and does not require Chrome to remain open. Dictation uses Windows' installed speech recognition engine; TTS generation still requires Groq/network access. Groq's hosted Orpheus English endpoint accepts up to 200 characters per request, so the app automatically splits longer text into short chunks and joins the returned WAV audio. Female voices: Hannah, Autumn, and Diana.

## Troubleshooting

If dictation cannot start, check Windows Settings → Privacy & security → Microphone and enable microphone access for desktop apps. Also check that Windows has an English speech-recognition language/engine installed. If the selected model/voice is unavailable to your Groq account, choose another supported model/voice.


## Free local read-aloud fallback

Choose **Local Windows Voice (Free)** in the Speech model menu to read text using installed Windows speech voices. This mode requires no Groq API key, internet connection, or API credits; audio is generated to a temporary WAV file and played through the selected output device. The available voice list depends on speech voices installed in Windows, and local voices may sound less natural than cloud neural voices. The Chrome speech bridge can still be used for dictation.


## Microsoft Edge voices (Free)

Choose **Microsoft Edge Voices (Free)** in the Speech model menu. The app opens its local speech bridge in Microsoft Edge and uses the voices exposed by Edge's browser speech engine. Suggested choices include Microsoft Aria (US), Sonia (UK), Ryan (UK), and Natasha (Australia), when those voices are available in the installed Edge environment. The voice list varies by Edge version, language packs, region, and network availability. This browser-speech mode requires no Groq API key or credits, but audio plays through Edge's selected output device rather than the app's NAudio output selector. Edge's separate Read Aloud voice catalog is not guaranteed to be exposed to browser speech APIs.

Groq cloud speech and Local Windows Voice remain available as separate options. Groq mode still requires a Groq API key; Local Windows Voice uses installed Windows voices and can generate a WAV file.
