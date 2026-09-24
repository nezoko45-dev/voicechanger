@echo off
setlocal
cd /d "%~dp0"
title Deepgram Flux Repeat Me - Priya
echo ==========================================
echo      Deepgram Flux Repeat Me - Priya
echo ==========================================
echo.
echo Redirecting to the current Priya Flux app...
echo.
call "%~dp0start-deepgram-priya.bat"
exit /b %errorlevel%
