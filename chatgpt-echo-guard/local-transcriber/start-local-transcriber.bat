@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run setup-local-transcriber.bat first.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" server.py
pause
