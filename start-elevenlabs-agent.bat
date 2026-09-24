@echo off
setlocal
cd /d "%~dp0"
title ElevenLabs Agent Repeat Me
echo ==========================================
echo       ElevenLabs Agent - Repeat Me
echo ==========================================
echo.
echo Opening the ElevenLabs Agent app...
echo Keep this window open while using the app.
echo.
set "URL=http://127.0.0.1:8766/elevenlabs-agent-repeat.html?v=2"
if exist "%~dp0elevenlabs-agent-id.txt" (
  set /p AGENT_ID=<"%~dp0elevenlabs-agent-id.txt"
  if not defined AGENT_ID goto NO_AGENT
  set "URL=http://127.0.0.1:8766/elevenlabs-agent-repeat.html?v=2^&agent=!AGENT_ID!"
)
:NO_AGENT
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
