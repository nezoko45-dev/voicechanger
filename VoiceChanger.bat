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

echo [1/2] Downloading the native RVC ONNX app...
echo A live progress bar will appear below.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='Continue';" ^
  "$r=Invoke-RestMethod 'https://api.github.com/repos/shirohata/vc-rs/releases/latest';" ^
  "$a=$r.assets | Where-Object { $_.name -like 'vc-rs-windowsml-*.zip' } | Select-Object -First 1;" ^
  "if(-not $a){throw 'Could not find the Windows ML release package.'};" ^
  "Write-Host ('Package: ' + $a.name); Write-Host ('Size: ' + [math]::Round($a.size/1MB,1) + ' MB');" ^
  "Start-BitsTransfer -Source $a.browser_download_url -Destination '%ZIP%' -DisplayName 'Downloading vc-rs'"

if errorlevel 1 (
  echo.
  echo DOWNLOAD FAILED.
  echo If BITS is unavailable, run this file again as normal.
  pause
  exit /b 1
)

if not exist "%ZIP%" (
  echo.
  echo DOWNLOAD DID NOT CREATE THE ZIP FILE.
  pause
  exit /b 1
)

echo.
echo [2/2] Extracting the voice changer...
echo Please wait - this can take a moment.
echo.

if exist "%APPDIR%" rmdir /s /q "%APPDIR%"
mkdir "%APPDIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='Continue'; Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%APPDIR%' -Force"

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
  echo vc-gui.exe was not found.
  echo Setup did not complete.
  pause
  exit /b 1
)

echo.
echo ==========================================
echo   LAUNCHING VOICE CHANGER
echo ==========================================
echo.
start "" "%APPDIR%\vc-gui.exe"
exit /b 0
