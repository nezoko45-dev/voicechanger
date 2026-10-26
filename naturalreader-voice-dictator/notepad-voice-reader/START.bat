@echo off
setlocal
title Notepad Voice Reader - Launcher

echo ==========================================
echo       Notepad Voice Reader
echo ==========================================
echo.

if not exist "%~dp0bridge.ps1" (
  echo ERROR: bridge.ps1 was not found.
  echo Keep START.bat in the same folder as bridge.ps1 and index.html.
  pause
  exit /b 1
)

if not exist "%~dp0index.html" (
  echo ERROR: index.html was not found.
  echo Keep START.bat in the same folder as bridge.ps1 and index.html.
  pause
  exit /b 1
)

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Windows PowerShell was not found.
  echo This launcher requires Windows PowerShell, normally included with Windows.
  pause
  exit /b 1
)

echo Starting the local Notepad bridge...
start "Notepad Voice Reader Bridge" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0bridge.ps1"

echo Waiting briefly for the bridge to start...
timeout /t 2 /nobreak >nul

echo Opening the voice reader in your default browser...
start "" "%~dp0index.html"

echo.
echo Started. Keep the PowerShell bridge window open while using the reader.
echo In the browser, choose a voice and click Start Dictation.
echo To stop the bridge, close its PowerShell window.
echo.
exit /b 0
