@echo off
setlocal EnableExtensions
title Chatterbox Launcher

set "APP_URL=https://nezoko45-dev.github.io/voicechanger/chatterbox-test/"
set "ROOT=%~dp0"
set "PYTHON="

echo.
echo  ==========================================
echo       CHATTERBOX - LOCAL PC LAUNCHER
echo  ==========================================
echo.
echo  Checking dependencies...
echo.

where py >nul 2>nul
if not errorlevel 1 (
  py -3.11 --version >nul 2>nul
  if not errorlevel 1 set "PYTHON=py -3.11"
)

if not defined PYTHON (
  where python >nul 2>nul
  if not errorlevel 1 (
    python -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,11) else 1)" >nul 2>nul
    if not errorlevel 1 set "PYTHON=python"
  )
)

if defined PYTHON (
  echo [OK] Python 3.11 found.
  %PYTHON% -m pip --version >nul 2>nul
  if errorlevel 1 (
    echo [MISSING] pip is not available for Python 3.11.
  ) else (
    echo [OK] pip found.
  )
  %PYTHON% -c "import torch" >nul 2>nul
  if errorlevel 1 (
    echo [MISSING] PyTorch is not installed.
  ) else (
    echo [OK] PyTorch found.
    %PYTHON% -c "import torch; print('      PyTorch:',torch.__version__); print('      CUDA available:',torch.cuda.is_available()); print('      GPU:',torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'No CUDA GPU detected')" 2>nul
  )
  %PYTHON% -c "import chatterbox" >nul 2>nul
  if errorlevel 1 (
    echo [MISSING] Chatterbox TTS package is not installed.
  ) else (
    echo [OK] Chatterbox package found.
  )
) else (
  echo [MISSING] Python 3.11 was not found.
  echo          Install Python 3.11 before local Chatterbox setup.
)

where nvidia-smi >nul 2>nul
if not errorlevel 1 (
  echo.
  echo [GPU] NVIDIA driver information:
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>nul
) else (
  echo.
  echo [INFO] NVIDIA-SMI not found. This does not rule out AMD or Intel graphics.
)

echo.
echo  Opening the Chatterbox GitHub Pages interface...
start "" "%APP_URL%"

echo.
echo  NOTE: This launcher currently checks prerequisites and opens
echo  the web interface. The local inference server will be added
echo  separately so the page can generate real cloned speech.
echo.
echo  Press any key to close this window.
pause >nul
endlocal
