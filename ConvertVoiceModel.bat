@echo off
setlocal
title RVC Voice Model Converter
cd /d "%~dp0"

echo.
echo ==========================================
echo   RVC VOICE MODEL CONVERTER
echo ==========================================
echo.
echo Supported input:
echo   .onnx       - already converted
echo   .pth        - supported RVC v2/F0
echo   .safetensors - inspect/convert with compatible RVC tools
echo.
echo NOTE: Non-RVC files cannot be converted into RVC voice models
echo without knowing their model architecture and configuration.
echo.

set "APPDIR=%~dp0vc-rs"
if not exist "%APPDIR%\vc-gui.exe" (
  echo vc-rs is not installed yet.
  echo Run VoiceChanger.bat first.
  echo.
  pause
  exit /b 1
)

echo Opening the native model converter...
echo Select your model in the RVC model browser.
echo Supported .pth RVC v2/F0 models can be converted to .onnx there.
echo.
start "" "%APPDIR%\vc-gui.exe"
exit /b 0
