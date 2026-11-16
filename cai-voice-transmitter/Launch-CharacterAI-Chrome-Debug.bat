@echo off
setlocal
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Chrome not found. Install Google Chrome first.
  pause
  exit /b 1
)
set "PROFILE=%LocalAppData%\CAI-Voice-Chrome"
echo Launching a dedicated Chrome profile with remote debugging on port 9222...
echo Sign into Character.AI in this Chrome window once; keep it open while using the transmitter.
start "" "%CHROME%" --user-data-dir="%PROFILE%" --remote-debugging-port=9222 --remote-allow-origins=* https://character.ai
