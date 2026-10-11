# VoiceChanger

Chrome extension + local Python API for capturing active-tab audio and converting speech toward a WAV reference using OpenVoice ToneColorConverter.

## Setup
1. Install Python 3.10/3.11 and FFmpeg.
2. Run start.bat to create a virtual environment and start the API at http://127.0.0.1:8765.
3. Install the official OpenVoice V2 package/dependencies and checkpoints from https://github.com/myshell-ai/OpenVoice. Put converter/config.json and converter/checkpoint.pth under checkpoints_v2. Checkpoints are not bundled; the reference WAV alone is not a model.
4. Visit chrome://extensions, enable Developer mode, choose Load unpacked, and select the extension folder.
5. Choose the preserved Recording (10).wav in the popup, click Start capture while speech plays in the active tab, then Stop & convert.
6. Listen to or download the converted WAV.

Audio is processed on localhost. Use only voices you own or have permission to use. OpenVoice setup can require dependency/checkpoint steps; conversion will report a clear error until those are installed.