@echo off
setlocal
cd /d "%~dp0"
title Deepgram Agent Repeat Me
echo ========================================
echo       Deepgram Agent - Repeat Me
echo ========================================
echo.
echo Opening the current Priya repeat-me app...
echo Keep this window open while using the app.
echo.
set "URL=http://127.0.0.1:8765/deepgram-agent-voice.html?v=priya-repeat-2"
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
