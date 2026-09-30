@echo off
setlocal
cd /d "%~dp0"
if not exist "voicechanger_web_bridge.exe" (
  echo voicechanger_web_bridge.exe is missing. Run the GitHub Actions build first.
  pause
  exit /b 1
)
if not exist "voicechanger.dll" (
  echo voicechanger.dll is missing.
  pause
  exit /b 1
)
if not exist "onnxruntime.dll" (
  echo onnxruntime.dll is missing.
  pause
  exit /b 1
)
echo Starting native RVC web bridge on http://127.0.0.1:8765
echo Keep this window open while using the GitHub Pages UI.
echo.
voicechanger_web_bridge.exe
pause
