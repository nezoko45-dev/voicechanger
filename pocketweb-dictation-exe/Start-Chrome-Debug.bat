@echo off
setlocal
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Google Chrome was not found in the standard install locations.
  echo Edit this file and set CHROME to your chrome.exe path.
  pause
  exit /b 1
)
set "PROFILE=%LOCALAPPDATA%\PocketWebDictation\ChromeProfile"
if not exist "%PROFILE%" mkdir "%PROFILE%"
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%PROFILE%" --new-window "https://pocketweb.tools/voice-cloning"
endlocal
