@echo off
setlocal
cd /d "%~dp0"
title Deepgram Agent Voice Audio
echo ========================================
echo      Deepgram Agent Voice Audio
echo ========================================
echo.
echo Starting local Chrome UI...
echo Keep this window open while using the app.
echo.
where py >nul 2>nul
if not errorlevel 1 (
  start "" "http://127.0.0.1:8765/deepgram-agent-voice.html"
  py -m http.server 8765 --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  start "" "http://127.0.0.1:8765/deepgram-agent-voice.html"
  python -m http.server 8765 --bind 127.0.0.1
  goto :eof
)
echo ERROR: Python is not installed.
echo Install Python, then run this file again.
pause
