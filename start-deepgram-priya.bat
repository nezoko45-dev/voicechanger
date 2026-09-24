@echo off
setlocal
cd /d "%~dp0"
title Deepgram Agent Repeat Me - Priya
echo ==========================================
echo     Deepgram Agent Repeat Me - Priya
echo ==========================================
echo.
echo Opening the fixed Deepgram Agent app...
echo Voice: Priya
echo Streaming mic directly through Deepgram's browser SDK.
echo No app-side word buffer.
echo.
set "URL=http://127.0.0.1:8765/deepgram-agent-voice.html?v=4&voice=flux-priya-en"
where py >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  py -m http.server 8765 --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  python -m http.server 8765 --bind 127.0.0.1
  goto :eof
)
echo ERROR: Python is not installed.
pause
