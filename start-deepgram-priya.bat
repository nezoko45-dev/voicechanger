@echo off
setlocal
cd /d "%~dp0"
title Deepgram Agent Repeat Me - Priya
echo ==========================================
echo     Deepgram Agent Repeat Me - Priya
echo ==========================================
echo.
echo Opening the Deepgram repeat-me app...
echo Voice: Priya (Flux TTS)
echo No app-side word buffer.
echo.
set "URL=http://127.0.0.1:8765/deepgram-agent-voice.html?v=priya-flux"
where py >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%^&voice=flux-priya-en"
  py -m http.server 8765 --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%^&voice=flux-priya-en"
  python -m http.server 8765 --bind 127.0.0.1
  goto :eof
)
echo ERROR: Python is not installed.
pause
