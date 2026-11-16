@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 22+: https://nodejs.org/ & pause & exit /b 1)
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (echo Chrome not found. Edit start.bat to set its path. & pause & exit /b 1)
if not exist "%~dp0chrome-profile" mkdir "%~dp0chrome-profile"
start "CAI Chrome Debug" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%~dp0chrome-profile" https://character.ai/
timeout /t 3 /nobreak >nul
start "CAI Speech Controller" http://127.0.0.1:8787
node server.mjs
