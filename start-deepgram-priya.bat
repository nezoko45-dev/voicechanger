@echo off
setlocal
cd /d "%~dp0"
title Deepgram Flux Repeat Me - Priya
echo ==========================================
echo      Deepgram Flux Repeat Me - Priya
echo ==========================================
echo.
echo Opening the NEW Flux repeat-me app...
echo Voice: Priya (flux-priya-en)
echo Mic: continuous streaming
echo Buffer: NONE
echo Session refresh: before maximum duration
echo.
set "URL=http://127.0.0.1:8770/deepgram-agent-voice.html?v=flux-priya-7"
where py >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  py -m http.server 8770 --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  python -m http.server 8770 --bind 127.0.0.1
  goto :eof
)
echo ERROR: Python is not installed.
pause
