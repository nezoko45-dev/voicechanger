@echo off
setlocal
cd /d "%~dp0"
echo ==========================================
echo   Local WAV Voice Agent Setup
echo ==========================================
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Installing Node.js LTS with winget...
  winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo Could not install Node.js automatically.
    echo Install Node.js 20+ and run this file again.
    pause
    exit /b 1
  )
)
where node
node --version
echo.
echo Installing local JavaScript dependencies...
call npm install
if errorlevel 1 goto fail

if not exist "models" mkdir "models"

if not exist "models\sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20\tokens.txt" (
  echo Downloading local streaming STT model...
  curl.exe -L --fail -o asr.tar.bz2 "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2"
  if errorlevel 1 goto fail
  tar -xjf asr.tar.bz2 -C models
  if errorlevel 1 goto fail
  del /q asr.tar.bz2
)

if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\vocab.json" (
  echo Downloading local PocketTTS voice-cloning model...
  curl.exe -L --fail -o pocket.tar.bz2 "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2"
  if errorlevel 1 goto fail
  tar -xjf pocket.tar.bz2 -C models
  if errorlevel 1 goto fail
  del /q pocket.tar.bz2
)

if not exist "Recording (10).wav" (
  echo ERROR: Recording (10).wav is missing from the repo folder.
  pause
  exit /b 1
)

echo.
echo Setup complete.
echo Your reference voice is: Recording (10).wav
echo.
echo Run start_local.bat to launch the app.
pause
exit /b 0

:fail
echo.
echo Setup failed. Check your internet connection and try again.
pause
exit /b 1