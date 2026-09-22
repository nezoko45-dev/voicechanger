@echo off
setlocal
cd /d "%~dp0"
title VoiceChanger - OpenVoice Live Conversion

echo ==========================================
echo VOICECHANGER - OPENVOICE LIVE CONVERSION
echo ==========================================
echo.
echo Deepgram: REMOVED
echo API key:  NOT USED
echo Engine:   OpenVoice V2 FP32 ONNX Runtime
echo Audio:    Chrome microphone -> live conversion -> selected output
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js 20+ is required only to serve the local app.
  echo Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)

if not exist "server.mjs" (
  echo ERROR: server.mjs is missing.
  pause
  exit /b 1
)

echo Starting local VoiceChanger server...
start "VoiceChanger Local Server" /D "%~dp0" cmd /k "node server.mjs"

set /a n=0
:wait
set /a n+=1
curl.exe -s -f --max-time 2 http://127.0.0.1:8765/health >nul 2>&1
if not errorlevel 1 goto launch
if %n% GEQ 30 goto fail
timeout /t 1 /nobreak >nul
goto wait

:launch
echo.
echo Local server is online.
echo Opening the live OpenVoice app in Chrome...
start "" "chrome.exe" --new-window "http://127.0.0.1:8765/"

echo.
echo In Chrome:
echo   1. Allow / Detect Microphones
echo   2. Select your microphone
echo   3. Load OpenVoice V2
echo   4. Select your reference .wav
echo   5. Select your Voicemeeter output
echo   6. Press Start Live Conversion
echo.
echo The browser performs the live voice conversion.
echo No Deepgram STT, Deepgram TTS, or Deepgram API is used.
echo.
exit /b 0

:fail
echo.
echo ERROR: The local VoiceChanger server did not start.
echo Check the "VoiceChanger Local Server" window for the exact error.
echo.
pause
exit /b 1
