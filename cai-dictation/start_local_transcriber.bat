@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
 echo Python 3.10+ was not found. Install it from https://www.python.org/downloads/windows/
 echo Enable the Python launcher during installation, then run this file again.
 pause
 exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
 echo Creating a private Python environment...
 py -3 -m venv .venv
 if errorlevel 1 goto fail
)
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto fail
echo Starting local Whisper. The first run downloads the model and may take several minutes.
".venv\Scripts\python.exe" local_transcriber.py
goto end
:fail
echo Setup failed. Review the error above.
pause
:end
endlocal
