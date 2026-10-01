@echo off
setlocal
cd /d "%~dp0"
if not exist build mkdir build
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
if errorlevel 1 goto fail
cmake --build build --config Release --parallel
if errorlevel 1 goto fail
copy /y build\Release\whisper.dll . >nul
copy /y build\Release\tts.dll . >nul
copy /y build\Release\tts_app.exe . >nul
echo.
echo BUILD COMPLETE
exit /b 0
:fail
echo BUILD FAILED
pause
exit /b 1
