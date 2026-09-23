@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title OpenVoice V2 Voice Clone

if "%~1"=="" (
    echo Drop a WAV file onto this BAT.
    pause
    exit /b 0
)

if /I not "%~x1"==".wav" (
    echo ERROR: Please drop a WAV file.
    pause
    exit /b 1
)

set "SOURCE=%~1"
set "APP=%~dp0index.html"

echo WAV received:
echo "%SOURCE%"
echo.
echo Opening Chrome...

REM Open the clone UI in Chrome and pass the WAV path to it.
where chrome >nul 2>nul
if not errorlevel 1 (
    start "" chrome "%APP%?wav=%SOURCE%"
    goto OPENED
)

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%APP%?wav=%SOURCE%"
    goto OPENED
)

if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%APP%?wav=%SOURCE%"
    goto OPENED
)

echo Chrome was not found.
echo Please install Google Chrome first.
pause
exit /b 1

:OPENED
echo Chrome opened.
echo The WAV was received successfully.
echo.
echo This window will stay open.
pause
exit /b 0
