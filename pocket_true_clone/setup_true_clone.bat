@echo off
setlocal
cd /d "%~dp0"
title Pocket TTS - True WAV Voice Clone Setup

echo.
echo ================================================
echo   Pocket TTS TRUE WAV VOICE CLONING SETUP
echo ================================================
echo.
echo This uses Kyutai's voice-cloning model, not the

echo without-voice-cloning model.
echo.

where uv.exe >nul 2>nul
if errorlevel 1 (
  echo [1/4] uv was not found. Installing uv...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
  if errorlevel 1 goto :fail
  set "PATH=%USERPROFILE%\.local\bin;%PATH%"
)

echo [2/4] Installing Pocket TTS CLI...
uv tool install pocket-tts
if errorlevel 1 goto :fail

set "PATH=%USERPROFILE%\.local\bin;%PATH%"

echo [3/4] Opening the official gated model page...
start "" "https://huggingface.co/kyutai/pocket-tts"
echo.
echo IMPORTANT: On the model page, accept the model access terms.
echo Then return here and press any key.
pause >nul

echo [4/4] Hugging Face login...
echo A browser/device login or token may be requested.
uvx hf auth login
if errorlevel 1 goto :fail

echo.
echo Checking authentication...
uvx hf auth whoami
if errorlevel 1 (
  echo Authentication check failed.
  goto :fail
)

echo.
echo ================================================
echo TRUE voice-cloning setup is ready.
echo ================================================
echo.
echo Run start_true_clone.bat
pause
exit /b 0

:fail
echo.
echo SETUP FAILED. Read the message above.
pause
exit /b 1
