@echo off
setlocal EnableExtensions
title Seed-VC Reference Voice Setup

cd /d "%~dp0"
echo.
echo ==========================================
echo   Seed-VC WAV / MP3 Reference Setup
echo ==========================================
echo.
echo This installs a private runtime inside this folder.
echo It does NOT require you to install Python manually.
echo The Intel graphics adapter is not a CUDA device;
echo this setup uses CPU-only PyTorch.
echo.

if not exist ".tools\uv.exe" (
  echo [1/4] Downloading the Windows runtime manager...
  if not exist ".tools" mkdir ".tools"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' -OutFile 'uv.zip'; Expand-Archive -Force 'uv.zip' '.tools\uv-unpack'; $f=Get-ChildItem '.tools\uv-unpack' -Recurse -Filter uv.exe | Select-Object -First 1; if(-not $f){throw 'uv.exe was not found in the downloaded archive'}; Copy-Item $f.FullName '.tools\uv.exe' -Force; Remove-Item 'uv.zip' -Force; Remove-Item '.tools\uv-unpack' -Recurse -Force"
  if errorlevel 1 goto :failed
)

if not exist "engine\real-time-gui.py" (
  echo [2/4] Downloading Seed-VC Realtime...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest 'https://codeload.github.com/jiaheguo521/seed-vc-realtime/zip/refs/heads/main' -OutFile 'seed-vc.zip'; if(Test-Path 'engine'){Remove-Item 'engine' -Recurse -Force}; Expand-Archive -Force 'seed-vc.zip' '.'; if(-not (Test-Path 'seed-vc-realtime-main\real-time-gui.py')){throw 'Seed-VC source archive did not contain the expected GUI'}; Move-Item 'seed-vc-realtime-main' 'engine'; Remove-Item 'seed-vc.zip' -Force"
  if errorlevel 1 goto :failed
)

echo [3/4] Installing private Python 3.10 runtime...
.tools\uv.exe python install 3.10
if errorlevel 1 goto :failed
if not exist ".venv\Scripts\python.exe" (
  .tools\uv.exe venv --python 3.10 .venv
  if errorlevel 1 goto :failed
)

echo [4/4] Installing CPU PyTorch and Seed-VC dependencies...
.tools\uv.exe pip install --python ".venv\Scripts\python.exe" torch==2.4.0 torchvision==0.19.0 torchaudio==2.4.0 --index-url https://download.pytorch.org/whl/cpu
if errorlevel 1 goto :failed
.tools\uv.exe pip install --python ".venv\Scripts\python.exe" -r "requirements-cpu.txt"
if errorlevel 1 goto :failed

echo.
echo Setup complete. Run start-voice-converter.bat.
echo First launch downloads the Seed-VC model files.
pause
exit /b 0

:failed
echo.
echo SETUP FAILED. The window is being kept open so you can read the error.
pause
exit /b 1
