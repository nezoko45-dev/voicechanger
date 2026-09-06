@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   Python WAV -> XTTS-v2 Speech Synthesis
echo ========================================
echo.

where py >nul 2>&1
if %errorlevel%==0 goto :python_ok
where python >nul 2>&1
if %errorlevel%==0 goto :python_ok

echo ERROR: Python was not found.
echo Install Python 3.10 or 3.11, then run this again.
pause
exit /b 1

:python_ok
echo Installing/checking Python TTS dependencies...
py -3 -m pip install -r requirements-tts.txt
if %errorlevel%==0 goto :start
python -m pip install -r requirements-tts.txt
if %errorlevel%==0 goto :start

echo ERROR: Dependency installation failed.
pause
exit /b 1

:start
echo.
echo Starting local Python TTS server...
echo The first run downloads the Whisper and XTTS-v2 models.
echo Keep this window open while using the app.
echo.
py -3 python_tts_server.py
if %errorlevel%==0 goto :end
python python_tts_server.py

:end
echo.
echo Python TTS server stopped.
pause
