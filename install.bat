@echo off
setlocal
cd /d "%~dp0"
echo.
echo === Local Hugging Face Repeat Voice setup ===
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found.
  echo Install Python 3.10+ from python.org, then run this file again.
  pause
  exit /b 1
)

where uv >nul 2>nul
if errorlevel 1 (
  echo Installing uv...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
  set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)

echo.
echo Installing local speech-to-speech dependencies...
uvx --from "speech-to-speech[kokoro]" speech-to-speech --help
if errorlevel 1 (
  echo.
  echo Dependency test failed.
  pause
  exit /b 1
)

echo.
echo Setup complete.
echo Run server.exe to start the app.
pause