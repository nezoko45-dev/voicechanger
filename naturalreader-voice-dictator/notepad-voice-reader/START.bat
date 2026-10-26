@echo off
setlocal
title Continuous Dictation and Voice Reader

echo ==========================================
echo   Continuous Dictation and Voice Reader
echo ==========================================
echo.
if not exist "%~dp0index.html" (
  echo ERROR: index.html was not found.
  echo Keep START.bat and index.html in the same folder.
  pause
  exit /b 1
)
echo Opening the voice reader in your default browser...
start "" "%~dp0index.html"
echo.
echo No Notepad app, PowerShell bridge, or extra dependencies are needed.
echo In the browser, choose a voice and click Start dictation.
echo.
exit /b 0
