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


## Microsoft Edge neural voices (Free)

**Microsoft Edge Voices (Free)** is selected by default, with **Microsoft Sonia Online (Natural) — English (United Kingdom)** selected first. The app calls the bundled `edge-tts-native.exe` helper directly to generate Sonia audio, then plays the resulting MP3 through NAudio and the selected Windows output device. It does not launch an Edge browser window for speech playback and does not require a Groq/OpenRouter API key or credits. An internet connection is required for the online neural voice. Other bundled choices include Aria (US), Ryan (UK), Natasha (Australia), and Jenny (US).

Groq cloud speech and Local Windows Voice remain available as separate options. Groq mode still requires a Groq API key; Local Windows Voice uses installed Windows voices and can generate a WAV file.
