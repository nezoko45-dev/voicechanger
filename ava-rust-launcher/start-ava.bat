@echo off
setlocal
cd /d "%~dp0"
title Ava Rust Voice Changer

if not exist "%~dp0vc-gui.exe" (
  echo.
  echo ERROR: vc-gui.exe was not found.
  echo Extract the complete Ava-Rust-Voice-Changer package first.
  echo Keep all DLL files beside vc-gui.exe.
  echo.
  pause
  exit /b 1
)

echo Starting vc-rs Windows voice conversion...
echo Select your microphone and an RVC voice model in the app.
echo The Ava model is NOT included; see models\Ava\README.txt.
start "" "%~dp0vc-gui.exe"
exit /b 0
