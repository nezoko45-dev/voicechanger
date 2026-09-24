@echo off
setlocal EnableExtensions EnableDelayedExpansion
title ONNX RVC Voice Changer

cd /d "%~dp0"

echo.
echo ==========================================
echo   ONNX RVC VOICE CHANGER
echo   Native Windows EXE - no Python
echo ==========================================
echo.

set "APPDIR=%~dp0vc-rs"
set "ZIP=%TEMP%\vc-rs-windowsml.zip"

if exist "%APPDIR%\vc-gui.exe" goto LAUNCH

echo Downloading the native RVC ONNX Windows app...
echo This is a one-time setup.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$r=Invoke-RestMethod 'https://api.github.com/repos/shirohata/vc-rs/releases/latest';" ^
  "$a=$r.assets | Where-Object { $_.name -like 'vc-rs-windowsml-*.zip' } | Select-Object -First 1;" ^
  "if(-not $a){throw 'Could not find the Windows ML release package.'};" ^
  "Invoke-WebRequest -Uri $a.browser_download_url -OutFile '%ZIP%'"

if errorlevel 1 (
  echo.
  echo DOWNLOAD FAILED.
  echo Check your internet connection and run this file again.
  pause
  exit /b 1
)

if exist "%APPDIR%" rmdir /s /q "%APPDIR%"
mkdir "%APPDIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%APPDIR%' -Force"
if errorlevel 1 (
  echo.
  echo EXTRACTION FAILED.
  pause
  exit /b 1
)

del /q "%ZIP%" >nul 2>&1

:LAUNCH
if not exist "%APPDIR%\vc-gui.exe" (
  echo.
  echo vc-gui.exe was not found after setup.
  echo.
  pause
  exit /b 1
)

echo Starting native ONNX RVC voice changer...
echo.
start "" "%APPDIR%\vc-gui.exe"
exit /b 0
