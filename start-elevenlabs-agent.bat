@echo off
setlocal
cd /d "%~dp0"
title ElevenLabs Agent Repeat Me
echo ==========================================
echo       ElevenLabs Agent - Repeat Me
echo ==========================================
echo.
echo Opening the latest ElevenLabs Agent app...
echo.
echo Enter your Agent ID in the webpage.
echo The webpage remembers it locally in Chrome.
echo.
set "URL=http://127.0.0.1:8766/elevenlabs-agent-repeat.html?v=3"
where py >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  py -m http.server 8766 --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  python -m http.server 8766 --bind 127.0.0.1
  goto :eof
)
echo ERROR: Python is not installed.
pause
