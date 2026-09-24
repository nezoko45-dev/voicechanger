@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Configure ElevenLabs Repeat Agent
echo ================================================
echo       ElevenLabs Agent - Repeat Me Setup
echo ================================================
echo.
echo This configures your existing ElevenLabs Agent:
echo   First message: HUMAN!! IM BACK!!
echo   Then: repeat exactly what the user says
echo   No "Are you still there?"
echo   Ava as the primary voice
echo   No additional / guy voices
echo.
set /p AGENT_ID=Enter your ElevenLabs Agent ID: 
if not defined AGENT_ID (
  echo.
  echo Agent ID is required.
  pause
  exit /b 1
)
echo.
set /p API_KEY=Enter your ElevenLabs API key: 
if not defined API_KEY (
  echo.
  echo API key is required.
  pause
  exit /b 1
)
echo.
echo Applying configuration...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0configure-elevenlabs-repeat.ps1" -AgentId "%AGENT_ID%" -ApiKey "%API_KEY%"
if errorlevel 1 (
  echo.
  echo Configuration failed. The setup window will remain open.
  pause
  exit /b 1
)
> "%~dp0elevenlabs-agent-id.txt" echo %AGENT_ID%
set "API_KEY="
echo.
echo Configuration complete.
echo Starting the repeat-me app...
echo.
call "%~dp0start-elevenlabs-agent.bat"
exit /b 0
