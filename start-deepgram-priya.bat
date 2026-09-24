@echo off
setlocal
cd /d "%~dp0"
title Deepgram Agent Repeat Me - Priya
echo ==========================================
echo     Deepgram Agent Repeat Me - Priya
echo ==========================================
echo.
echo Opening the refreshed Deepgram Agent app...
echo Voice: Priya (flux-priya-en)
echo Session refresh: 110 minutes
echo Keep this window open while using the app.
echo.
set "URL=http://127.0.0.1:8767/deepgram-agent-voice.html?v=6"
where py >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  py -m http.server 8767 --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  python -m http.server 8767 --bind 127.0.0.1
  goto :eof
)
echo ERROR: Python is not installed.
pause
