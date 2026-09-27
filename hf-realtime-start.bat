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
echo Starting local VAD + Parakeet STT + Qwen + Kokoro...
echo The first launch can take a while while models load.
echo.
start "HF Realtime Backend" cmd /k ""%P%" -m speech_to_speech.cli serve --stt parakeet-tdt --stt_device cpu --llm_backend transformers --model_name Qwen/Qwen2.5-0.5B-Instruct --llm_device cpu --llm_torch_dtype float32 --llm_gen_max_new_tokens 96 --tts kokoro --kokoro_device cpu --kokoro_voice af_heart --enable_live_transcription --host 127.0.0.1 --port 8765"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:8766/"
"%P%" -m http.server 8766 --bind 127.0.0.1
