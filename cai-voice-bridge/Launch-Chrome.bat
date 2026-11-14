@echo off
setlocal
set "PROFILE=%LOCALAPPDATA%\CAIVoiceBridge\ChromeProfile"
if not exist "%PROFILE%" mkdir "%PROFILE%"
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if "%BROWSER%"=="" (
  echo Chrome not found. Edit this file and set BROWSER to your browser executable.
  pause
  exit /b 1
)
start "" "%BROWSER%" --remote-debugging-port=9222 --user-data-dir="%PROFILE%" https://character.ai
echo.
echo This is a separate Chrome profile. Sign into Character.AI once in this profile.
echo Keep this browser open while the Voice Bridge runs.
