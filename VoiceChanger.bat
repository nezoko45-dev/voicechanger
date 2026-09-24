@echo off
setlocal EnableExtensions
title Native ONNX VoiceChanger
cd /d "%~dp0"

set "APP=%~dp0native\app\VoiceChanger.exe"

if not exist "%APP%" (
  echo.
  echo ==================================================
  echo          NATIVE ONNX VOICECHANGER
  echo ==================================================
  echo.
  echo The native EXE is not built yet.
  echo Running the build batch now...
  echo.
  call "%~dp0BuildNativeVoiceChanger.bat"
)

if not exist "%APP%" (
  echo.
  echo VoiceChanger.exe is still missing.
  echo.
  pause
  exit /b 1
)

start "" "%APP%"
exit /b 0
