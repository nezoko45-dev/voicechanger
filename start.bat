@echo off
cd /d "%~dp0"

if not exist "%~dp0server.exe" (
  echo.
  echo server.exe was not found.
  echo Download the VoiceChangerServer package from GitHub Actions,
  echo extract it, and run install.bat first.
  echo.
  pause
  exit /b 1
)

start "" "%~dp0server.exe"
