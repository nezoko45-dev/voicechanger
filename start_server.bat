@echo off
cd /d "%~dp0"
if not exist "server.exe" (echo server.exe is missing. Run the GitHub Actions build or build_server.bat.&pause&exit /b 1)
start "" "%~dp0server.exe"
