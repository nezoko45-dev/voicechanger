@echo off
setlocal
cd /d "%~dp0"

if not exist "RVC\vc-gui.exe" (
  echo.
  echo ========================================
  echo  Local RVC engine is not installed
  echo ========================================
  echo.
  echo Put the extracted vc-rs Windows package here:
  echo.
  echo   %~dp0RVC\vc-gui.exe
  echo.
  echo Then run this file again.
  echo.
  echo The recommended package is the Windows ML build.
  echo An NVIDIA TensorRT build can also be used on compatible NVIDIA GPUs.
  echo.
  start "" "https://github.com/shirohata/vc-rs/releases"
  pause
  exit /b 1
)

echo Starting local RVC...
start "" "%~dp0RVC\vc-gui.exe"
exit /b 0
