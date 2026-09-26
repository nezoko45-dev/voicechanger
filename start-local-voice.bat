@echo off
setlocal
cd /d "%~dp0"
title Local Voice Repeat - Whisper + Piper
echo ==========================================
echo        LOCAL VOICE REPEAT
echo ==========================================
echo.
echo 100%% local - no Deepgram credits.
echo Whisper.cpp STT + Piper TTS.
echo Opening browser...
echo.
set "PORT=8918"
set "URL=http://127.0.0.1:%PORT%/local-voice.html?v=LOCAL-20260926"
start "" "%URL%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-voice-server.ps1" -Port %PORT%
