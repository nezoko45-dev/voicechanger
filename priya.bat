@echo off
setlocal
cd /d "%~dp0"
title PRIYA - Deepgram Flux Repeat Me
echo ==========================================
echo          PRIYA - FRESH LAUNCHER
echo ==========================================
echo.
echo Opening a completely fresh Priya app URL...
echo Voice: Priya (flux-priya-en)
echo Cache bust: PRIYA-FRESH-20260925
echo Session refresh: before maximum duration
echo.
set "URL=http://127.0.0.1:8788/deepgram-agent-voice.html?v=PRIYA-FRESH-20260925"
where py >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  py -m http.server 8788 --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  python -m http.server 8788 --bind 127.0.0.1
  goto :eof
)
echo ERROR: Python is not installed.
pause
