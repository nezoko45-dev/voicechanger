@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.10 is required.
  pause
  exit /b 1
)
if not exist "Seed-VC\real-time-gui.py" (
  git clone https://github.com/Plachtaa/seed-vc.git Seed-VC
  if errorlevel 1 (
    echo Git is required to download Seed-VC.
    pause
    exit /b 1
  )
)
cd /d "%~dp0Seed-VC"
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo Seed-VC dependency installation failed.
  pause
  exit /b 1
)
echo.
echo Seed-VC is installed.
echo Return to Unity and press START VOICE ENGINE.
pause
