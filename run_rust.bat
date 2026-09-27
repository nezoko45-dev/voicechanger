@echo off
setlocal
cd /d "%~dp0"
if not exist "target\release\voicechanger.exe" (
  echo Rust launcher is not built yet. Running setup...
  call setup_seedvc.bat
  if errorlevel 1 exit /b 1
)
start "" "%~dp0target\release\voicechanger.exe"
