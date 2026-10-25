@echo off
setlocal
cd /d "%~dp0"
echo This opens two local windows: the VoiceClonNX backend and the microphone UI.
start "VoiceClonNX Backend" cmd /k ""%~dp0start_backend.bat""
timeout /t 2 /nobreak >nul
start "VoiceClonNX UI" cmd /k ""%~dp0start_ui.bat""
