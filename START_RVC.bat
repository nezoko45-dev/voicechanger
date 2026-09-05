@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   RVC Live Voice Changer Launcher
echo ========================================
echo.

echo Checking Python...
where py >nul 2>&1
if %errorlevel%==0 goto :python_ok
where python >nul 2>&1
if %errorlevel%==0 goto :python_ok

echo.
echo ERROR: Python was not found on this computer.
echo Install Python 3.10 or newer, then run this file again.
echo.
pause
exit /b 1

:python_ok
echo Python found.
echo.

echo Checking RVC dependencies...
py -3 -c "import rvc_python" >nul 2>&1
if %errorlevel%==0 goto :deps_ok
python -c "import rvc_python" >nul 2>&1
if %errorlevel%==0 goto :deps_ok

echo RVC Python package is missing.
echo Installing it now...
echo.
py -3 -m pip install rvc-python==0.1.5 numpy soundfile "websockets>=12,<16"
if %errorlevel%==0 goto :deps_ok
python -m pip install rvc-python==0.1.5 numpy soundfile "websockets>=12,<16"
if %errorlevel%==0 goto :deps_ok

echo.
echo ERROR: Could not install the RVC dependencies.
echo Check the messages above for the actual Python/pip error.
echo.
pause
exit /b 1

:deps_ok
echo Dependencies are ready.
echo.
if exist "%~dp0models\d32k.pth" (
    echo Found models\d32k.pth
) else (
    echo WARNING: models\d32k.pth was not found yet.
    echo Put your RVC .pth model inside the models folder.
)
echo.

echo Starting RVC server...
echo Keep this window open while using the voice changer.
echo.
py -3 rvc_server.py
if %errorlevel%==0 goto :end
python rvc_server.py

:end
echo.
echo RVC server stopped.
pause
