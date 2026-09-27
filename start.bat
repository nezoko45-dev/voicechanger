@echo off
cd /d "%~dp0"
if exist server.exe (
  start "" "%~dp0server.exe"
) else (
  python server.py
)