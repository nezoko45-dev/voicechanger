@echo off
setlocal
cd /d "%~dp0"
if not exist "Seed-VC\real-time-gui.py" (
  echo Run setup_seedvc.bat first.
  pause
  exit /b 1
)
cd /d "%~dp0Seed-VC"
python real-time-gui.py --fp16 True
pause
