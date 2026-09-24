@echo off
setlocal EnableExtensions
title Native ONNX VoiceChanger
cd /d "%~dp0"

echo.
echo ==================================================
echo             NATIVE ONNX VOICECHANGER
echo ==================================================
echo.
echo This is the only launcher you need.
echo.
echo It will build the native EXE once, then open it.
echo No RVC.cpp download is used.
echo No Python voice engine is used.
echo.

if not exist "%~dp0native\app\VoiceChanger.exe" (
  call "%~dp0BuildNativeVoiceChanger.bat"
)

if not exist "%~dp0native\app\VoiceChanger.exe" (
  echo.
  echo VoiceChanger.exe was not created.
  echo.
  pause
  exit /b 1
)

start "" "%~dp0native\app\VoiceChanger.exe"
exit /b 0
