@echo off
setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo  Local Hugging Face Repeat Voice Setup
echo ========================================
echo.

where uvx >nul 2>nul
if not errorlevel 1 goto :test

where uv >nul 2>nul
if not errorlevel 1 goto :test

echo uv was not found.
echo Installing uv...
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"

set "PATH=%USERPROFILE%\.local\bin;%PATH%"

where uvx >nul 2>nul
if errorlevel 1 (
  echo.
  echo Could not find uvx after installation.
  echo Close this window, reopen it, and run install.bat again.
  pause
  exit /b 1
)

:test
echo.
echo Testing the local speech-to-speech package...
uvx --from "speech-to-speech[kokoro]" speech-to-speech --help

if errorlevel 1 (
  echo.
  echo The Hugging Face speech-to-speech package could not start.
  echo Check your internet connection and run install.bat again.
  pause
  exit /b 1
)

echo.
echo Setup complete.
echo.
echo Now run server.exe.
echo The local browser page will open automatically.
echo.
pause
