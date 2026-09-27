@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Hugging Face Realtime - Local

if not exist ".hf-realtime-env\Scripts\python.exe" (
  echo Local environment not found.
  echo Run hf-realtime-setup.bat first.
  pause
  exit /b 1
)

set "P=%~dp0.hf-realtime-env\Scripts\python.exe"
echo ==========================================================
echo        HUGGING FACE REALTIME - LOCAL
echo ==========================================================
echo.
echo Starting local speech-to-speech backend...
echo Backend: ws://127.0.0.1:8765/v1/realtime
echo.

start "HF Realtime Backend" cmd /k ""%P%" -m speech_to_speech.cli serve --stt parakeet-tdt --stt_device cpu --llm_backend transformers --model_name Qwen/Qwen2.5-0.5B-Instruct --llm_device cpu --llm_torch_dtype float32 --llm_gen_max_new_tokens 96 --tts kokoro --kokoro_device cpu --kokoro_voice af_heart --enable_live_transcription --host 127.0.0.1 --port 8765"

echo Waiting for the backend...
set /a tries=0
:wait
set /a tries+=1
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $c=New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',8765); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto ready
if %tries% GEQ 60 goto timeout
timeout /t 1 /nobreak >nul
goto wait

:ready
echo Backend is ready.
echo Opening the local UI...
start "" "http://127.0.0.1:8766/"
"%P%" -m http.server 8766 --bind 127.0.0.1
goto :eof

:timeout
echo.
echo ==========================================================
echo BACKEND DID NOT START
echo ==========================================================
echo Check the "HF Realtime Backend" window for the actual error.
echo.
pause
