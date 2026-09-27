@echo off
setlocal
title Local Live Voice Changer

set "ROOT=%~dp0"
set "VC=%ROOT%VCClient"

if exist "%VC%\start_http.bat" (
  echo Starting local VCClient...
  cd /d "%VC%"
  call start_http.bat
  exit /b
)

if exist "%VC%\startHttp.bat" (
  echo Starting local VCClient...
  cd /d "%VC%"
  call startHttp.bat
  exit /b
)

echo.
echo VCClient is not installed yet.
echo.
echo This launcher expects the Windows VCClient/RVC package
echo to be extracted into:
echo.
echo   %VC%
echo.
echo Download the Windows VCClient package from the official
echo W-Okada Voice Changer project, extract it as VCClient,
echo then run this file again.
echo.
echo Official project:
echo https://github.com/w-okada/voice-changer
echo.
pause
