@echo off
setlocal
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
echo Installing/checking Python TTS dependencies...
%PY% -m pip install -r requirements-tts.txt
if not %errorlevel%==0 goto :install_failed

REM If the server is already alive, do not start a duplicate copy.
curl.exe -fsS --max-time 2 http://127.0.0.1:8787/health >nul 2>&1
if %errorlevel%==0 goto :already_running

echo.
echo Starting local Python TTS server in a separate window...
start "Python TTS Server" cmd /k "%PY% python_tts_server.py"

echo Waiting for the server to come online...
set /a tries=0
:wait_loop
set /a tries+=1
curl.exe -fsS --max-time 2 http://127.0.0.1:8787/health >nul 2>&1
if %errorlevel%==0 goto :server_ready
if %tries% GEQ 60 goto :server_failed
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

:server_failed
echo.
echo ERROR: Python server did not respond after 60 seconds.
echo Check the Python TTS Server window for the error.
pause
exit /b 1

:install_failed
echo.
echo ERROR: Dependency installation failed.
pause
exit /b 1

:done
echo.
echo Keep the Python TTS Server window open while using the app.
echo You can close this launcher window now.
exit /b 0
