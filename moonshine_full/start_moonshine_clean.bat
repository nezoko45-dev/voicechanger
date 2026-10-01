@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  pause
  exit /b 1
)
start "Moonshine cache reset" http://127.0.0.1:8788/reset_cache.html
node serve.mjs
pause
