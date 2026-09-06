@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo   Python WAV -^> XTTS-v2 Speech Synthesis
echo ========================================
echo.

where py >nul 2>&1
if %errorlevel%==0 set "PY=py -3"&goto :python_ok
where python >nul 2>&1
if %errorlevel%==0 set "PY=python"&goto :python_ok

echo ERROR: Python was not found.
echo Install Python 3.10 or 3.11, then run this again.
pause
exit /b 1

:python_ok
REM This launcher no longer depends on requirements-tts.txt being present.
REM Install the packages directly so a partial repo download still works.
echo Installing/checking Python TTS dependencies...
%PY% -m pip install --upgrade pip
if not %errorlevel%==0 goto :install_failed
%PY% -m pip install "flask>=3.0,<4" "flask-cors>=4,<7" "faster-whisper>=1.1,<2" "coqui-tts>=0.27,<1"
if not %errorlevel%==0 goto :install_failed

REM If the server is already alive, do not start a duplicate copy.
curl.exe -fsS --max-time 2 http://127.0.0.1:8787/health >nul 2>&1
if %errorlevel%==0 goto :already_running

if not exist "%~dp0python_tts_server.py" goto :server_missing

echo.
echo Starting local Python TTS server in a separate window...
start "Python TTS Server" cmd /k "%PY% "%~dp0python_tts_server.py""

echo Waiting for the server to come online...
set /a tries=0
:wait_loop
set /a tries+=1
curl.exe -fsS --max-time 2 http://127.0.0.1:8787/health >nul 2>&1
if %errorlevel%==0 goto :server_ready
if %tries% GEQ 120 goto :server_failed
timeout /t 1 /nobreak >nul
goto :wait_loop

:server_ready
echo.
echo [OK] Python TTS server is RUNNING on http://127.0.0.1:8787
echo.
echo Opening the Voice Changer app...
start "" "%~dp0index.html"
goto :done

:already_running
echo.
echo [OK] Python TTS server is ALREADY RUNNING on http://127.0.0.1:8787
echo.
echo Opening the Voice Changer app...
start "" "%~dp0index.html"
goto :done

:server_missing
echo.
echo ERROR: python_tts_server.py was not found next to this BAT file.
echo Make sure you downloaded/cloned the whole voicechanger repository.
pause
exit /b 1

:server_failed
echo.
echo ERROR: Python server did not respond after 120 seconds.
echo The model may still be downloading, or Python encountered an error.
echo Check the Python TTS Server window for the actual error.
pause
exit /b 1

:install_failed
echo.
echo ERROR: Python TTS dependencies could not be installed.
echo Check your internet connection and the Python version.
pause
exit /b 1

:done
echo.
echo Keep the Python TTS Server window open while using the app.
echo You can close this launcher window now.
exit /b 0
