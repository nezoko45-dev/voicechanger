@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ==========================================
echo   RVC REALTIME VOICE CHANGER SETUP
echo ==========================================
echo.
echo This installs the current official RVC WebUI.
echo The target voice will be trained from:
echo   Recording (10).wav
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo Git was not found.
  echo Install Git for Windows, then run this again.
  pause
  exit /b 1
)

set "PYEXE="
py -3.12 -c "import sys; print(sys.version)" >nul 2>nul
if not errorlevel 1 set "PYEXE=py -3.12"

if not defined PYEXE (
  python --version >nul 2>nul
  if errorlevel 1 (
    echo Python 3.12 was not found.
    echo Install Python 3.12 x64, then run this again.
    pause
    exit /b 1
  )
  set "PYEXE=python"
)

if not exist "rvc-realtimewebui.py" (
  echo Downloading the official RVC repository...
  git clone https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI.git rvc-realtime
  if errorlevel 1 goto :fail
)

cd /d "%~dp0rvc-realtime"

if not exist "venv\Scripts\python.exe" (
  echo Creating the RVC Python environment...
  %PYEXE% -m venv venv
  if errorlevel 1 goto :fail
)

echo.
echo Upgrading pip...
venv\Scripts\python.exe -m pip install --upgrade pip
if errorlevel 1 goto :fail

echo.
echo Detecting graphics hardware...
where nvidia-smi >nul 2>nul
if errorlevel 1 goto :cpu

nvidia-smi --query-gpu=name --format=csv,noheader 2>nul | findstr /i "RTX 50" >nul
if not errorlevel 1 goto :cu128

echo NVIDIA GPU detected - using CUDA 11.8 dependencies.
venv\Scripts\python.exe -m pip install -r requirments_cu118_py312.txt
if errorlevel 1 goto :fail
goto :models

:cu128
echo RTX 50-series NVIDIA GPU detected - using CUDA 12.8 dependencies.
venv\Scripts\python.exe -m pip install -r requirments_cu128_py312.txt
if errorlevel 1 goto :fail
goto :models

:cpu
echo No NVIDIA GPU detected - using CPU/AMD/Intel dependency set.
venv\Scripts\python.exe -m pip install -r requirments_cpu_py312.txt
if errorlevel 1 goto :fail

:models
cd /d "%~dp0"
echo.
echo Downloading RVC models and FFmpeg if needed...
call download_rvc_models.bat
if errorlevel 1 goto :fail

echo.
echo ==========================================
echo   RVC SETUP COMPLETE
echo ==========================================
echo.
echo Next step:
echo   train_reference_rvc.bat
echo.
pause
exit /b 0

:fail
cd /d "%~dp0"
echo.
echo RVC setup failed. Read the error above.
pause
exit /b 1
