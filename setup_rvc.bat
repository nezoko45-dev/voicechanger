@echo off
setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo  Local RVC Voice Changer Setup
echo ========================================
echo.
echo This setup intentionally does not install Python,
echo PyTorch, Hugging Face speech-to-speech, or Tone.js.
echo.
if exist "RVC\vc-gui.exe" (
  echo RVC is already installed.
  echo.
  pause
  exit /b 0
)

mkdir "RVC" >nul 2>nul

echo Opening the official vc-rs releases...
echo.
echo Download the Windows ML ZIP for the simplest setup.
echo Extract its contents into:
echo.
echo   %~dp0RVC
echo.
echo The folder must contain:
echo   RVC\vc-gui.exe
echo.
start "" "https://github.com/shirohata/vc-rs/releases"
echo.
echo After extraction, run start_rvc.bat.
echo.
pause
