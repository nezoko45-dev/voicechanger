@echo off
setlocal EnableExtensions
cd /d "%~dp0"
mkdir models 2>nul
mkdir piper 2>nul

echo === Whisper tiny.en ===
if not exist models\ggml-tiny.en.bin (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin?download=true' -OutFile 'models\ggml-tiny.en.bin'"
  if errorlevel 1 goto :fail
)

echo === Piper Windows ===
if not exist piper\piper.exe (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_windows_amd64.zip' -OutFile 'piper.zip'"
  if errorlevel 1 goto :fail
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force 'piper.zip' 'piper_extract'"
  if errorlevel 1 goto :fail
  for /r piper_extract %%F in (piper.exe) do copy /y "%%F" piper\piper.exe >nul
  if not exist piper\piper.exe goto :fail
)

echo === Female Piper voice ===
if not exist piper\en_US-lessac-medium.onnx (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx?download=true' -OutFile 'piper\en_US-lessac-medium.onnx'"
  if errorlevel 1 goto :fail
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json?download=true' -OutFile 'piper\en_US-lessac-medium.onnx.json'"
  if errorlevel 1 goto :fail
)
echo Models ready.
exit /b 0
:fail
echo Model download failed. Check your internet connection and URLs.
exit /b 1
