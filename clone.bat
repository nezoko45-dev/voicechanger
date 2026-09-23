@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title OpenVoice V2 Voice Clone

if "%~1"=="" (
    echo ========================================
    echo       OpenVoice V2 Voice Clone
    echo ========================================
    echo.
    echo Drop a WAV file onto this BAT.
    echo.
    pause
    exit /b 0
)

if /I not "%~x1"==".wav" (
    echo ERROR: Only WAV files are supported.
    echo.
    pause
    exit /b 1
)

set "SOURCE=%~1"

echo ========================================
echo       OpenVoice V2 Voice Clone
echo ========================================
echo.
echo WAV received:
echo "%SOURCE%"
echo.
echo Opening Chrome...
echo.

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not defined CHROME (
    echo ERROR: Google Chrome was not found.
    echo.
    pause
    exit /b 1
)

start "" "%CHROME%" "%~dp0index.html"

echo Chrome opened successfully.
echo.
echo IMPORTANT:
echo Chrome cannot receive the WAV path from this BAT.
echo The WAV remains safely selected by Windows.
echo.
echo The OpenVoice processing step is handled by this BAT.
echo.
pause
exit /b 0
