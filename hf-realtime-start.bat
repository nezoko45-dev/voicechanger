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
echo Starting the local browser UI first...
start "HF Realtime UI Server" cmd /k ""%P%" -m http.server 8766 --bind 127.0.0.1"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8766/index.html"

echo.
echo Starting local speech-to-speech backend...
echo Backend: ws://127.0.0.1:8765/v1/realtime
echo.

start "HF Realtime Backend" cmd /k ""%P%" -m speech_to_speech.cli serve --stt parakeet-tdt --stt_device cpu --llm_backend transformers --model_name Qwen/Qwen2.5-0.5B-Instruct --llm_device cpu --llm_torch_dtype float32 --llm_gen_max_new_tokens 96 --tts kokoro --kokoro_device cpu --kokoro_voice af_heart --enable_live_transcription --host 127.0.0.1 --port 8765"

echo.
echo The browser UI should now be open.
echo Wait for the backend window to finish loading before pressing START.
echo.
pause
