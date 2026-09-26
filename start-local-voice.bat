@echo off
setlocal
cd /d "%~dp0"
title Local Voice Repeat
echo ==========================================
echo           LOCAL VOICE REPEAT
echo ==========================================
echo.
echo 100%% local - no Deepgram.
echo Whisper.cpp STT + Piper TTS.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-voice-server.ps1" -Port 8908
