@echo off
setlocal EnableExtensions
title Seed-VC Reference Voice Setup

cd /d "%~dp0"
echo.
echo ==========================================
echo   Seed-VC WAV / MP3 Reference Setup
echo ==========================================
echo.
echo This installs a project-isolated Python runtime.
echo It does NOT require you to install Python manually.
echo The Intel graphics adapter is not a CUDA device;
echo this setup uses CPU-only PyTorch.
echo.

REM Check available space before downloading large PyTorch wheels.
echo Checking available disk space...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$drive=(Get-Item -LiteralPath '.').PSDrive.Name; $disk=Get-CimInstance Win32_LogicalDisk -Filter ('DeviceID='''+$drive+':'''); $free=[math]::Round($disk.FreeSpace/1GB,1); Write-Host ('Free space on '+$drive+': is '+$free+' GB'); if($disk.FreeSpace -lt 6GB){Write-Host 'Please free at least 6 GB on this drive, then run setup again.'; exit 2}"
if errorlevel 1 goto :failed_space

REM Keep uv's cache in this project so it can be cleaned without touching other apps.
set "UV_CACHE_DIR=%CD%\.uv-cache"

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
echo Installing without retaining duplicate package-cache copies...
.tools\uv.exe pip install --no-cache --python ".venv\Scripts\python.exe" torch==2.4.0 torchvision==0.19.0 torchaudio==2.4.0 --index-url https://download.pytorch.org/whl/cpu
if errorlevel 1 goto :failed

.tools\uv.exe pip install --no-cache --python ".venv\Scripts\python.exe" -r "requirements-cpu.txt"
if errorlevel 1 goto :failed

REM Remove only this installer's temporary uv cache after a successful setup.
if exist ".uv-cache" rmdir /s /q ".uv-cache"

echo.
echo Setup complete. Run start-voice-converter.bat.
echo First launch downloads the Seed-VC model files.
pause
exit /b 0

:failed_space
echo.
echo SETUP STOPPED: not enough free disk space for CPU PyTorch.
echo Free at least 6 GB on the drive containing this folder.
echo Then run setup.bat again. Your existing files are preserved.
pause
exit /b 2

:failed
echo.
echo SETUP FAILED. Temporary installer cache is at ".uv-cache".
echo If disk space is low, free at least 6 GB and run setup.bat again.
echo The window is being kept open so you can read the error.
pause
exit /b 1
