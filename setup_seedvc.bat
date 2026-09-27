@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ==========================================
echo   WAV Reference Voice Changer Setup
echo ==========================================
echo.

where rustc >nul 2>nul
if errorlevel 1 (
  echo Rust is not installed or not on PATH.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo Python 3.10+ was not found.
  echo Seed-VC's neural runtime currently requires Python/PyTorch.
  echo Rust is the native launcher/UI; Seed-VC supplies the zero-shot model runtime.
  pause
  exit /b 1
)

if not exist "seed-vc-realtime\real-time-gui.py" (
  echo Downloading Seed-VC Realtime...
  git clone https://github.com/jiaheguo521/seed-vc-realtime.git seed-vc-realtime
  if errorlevel 1 (
    echo Git clone failed. Make sure Git is installed.
    pause
    exit /b 1
  )
)

cd /d "%~dp0seed-vc-realtime"

if not exist "venv\Scripts\python.exe" (
  echo Creating local Python environment...
  python -m venv venv
  if errorlevel 1 goto :fail
)

echo Installing Seed-VC dependencies...
venv\Scripts\python.exe -m pip install --upgrade pip
venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto :fail

echo Installing PyTorch...
venv\Scripts\python.exe -m pip install -U torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
if errorlevel 1 (
  echo CUDA PyTorch install failed. Trying standard PyPI...
  venv\Scripts\python.exe -m pip install -U torch torchvision torchaudio
  if errorlevel 1 goto :fail
)

cd /d "%~dp0"
cargo build --release
if errorlevel 1 goto :fail

echo.
echo Setup complete. Run run_rust.bat.
pause
exit /b 0

:fail
cd /d "%~dp0"
echo.
echo Setup failed. Read the error above.
pause
exit /b 1
