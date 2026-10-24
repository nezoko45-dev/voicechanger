@echo off
setlocal
cd /d "%~dp0"
echo ChatGPT Echo Guard - local Whisper setup
echo First setup downloads Python packages and the English Whisper model.
py -3 -m venv .venv
if errorlevel 1 goto :error
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
if errorlevel 1 goto :error
python -m pip install -r requirements.txt
if errorlevel 1 goto :error
echo Setup complete. Run start-local-transcriber.bat before enabling audio comparison.
pause
exit /b 0
:error
echo Setup failed. Install Python 3.10-3.12 (64-bit), then run this file again.
pause
exit /b 1
