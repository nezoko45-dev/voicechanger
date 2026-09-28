@echo off
setlocal
cd /d "%~dp0"

if not exist "rvc-realtime\venv\Scripts\python.exe" (
  echo RVC is not installed yet.
  echo Run setup_rvc.bat first.
  pause
  exit /b 1
)

cd /d "%~dp0rvc-realtime"

echo ==========================================
echo   RVC REALTIME VOICE CHANGER
echo ==========================================
echo.
echo The RVC realtime GUI will open now.
echo Select your input microphone and output
echo device, then select your trained .pth model.
echo.
echo For VRChat:
echo   RVC output -> Voicemeeter -> VRChat mic
echo.

venv\Scripts\python.exe infer-web.py
pause
