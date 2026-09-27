@echo off
setlocal
cd /d "%~dp0"
title SpeechStack - Whisper + Piper
echo ==========================================
echo        LOCAL SPEECHSTACK
echo ==========================================
echo.
echo 100%% local - no Deepgram credits.
echo Whisper.cpp STT + Piper TTS.
echo Opening browser...
echo.
set "PORT=8918"
set "URL=http://127.0.0.1:%PORT%/?v=SPEECHSTACK-CONTINUOUS-20260927"
start "" "%URL%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-voice-server.ps1" -Port %PORT%
