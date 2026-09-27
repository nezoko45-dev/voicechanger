@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (echo Run setup_server.bat first.&pause&exit /b 1)
call ".venv\Scripts\activate.bat"
python server.py
