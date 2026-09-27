@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\sherpa-onnx-node" (
  echo Dependencies are missing. Run setup_local.bat first.
  pause
  exit /b 1
)
start "Local Voice Agent Server" cmd /k "node server.js"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:8787/"
echo Local voice agent started.
echo Keep the server window open while using it.
