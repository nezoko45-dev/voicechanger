@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Hugging Face Local Speech-to-Speech - Female Voice

echo ==========================================================
echo        HUGGING FACE LOCAL SPEECH-TO-SPEECH
echo ==========================================================
echo.
echo Local VAD + Parakeet STT + small local LLM + Kokoro TTS
echo Female voice: af_heart
echo No Deepgram. No Ollama. No cloud API.
echo.
echo NOTE: The first run downloads the Hugging Face models.
echo.

where py >nul 2>&1
if %errorlevel%==0 (
  py -3.11 -c "import sys" >nul 2>&1
  if not errorlevel 1 set "PY=py -3.11"
) else (
  where python >nul 2>&1
  if errorlevel 1 (
    echo Python 3.11 was not found.
    echo Install Python 3.11 or newer, then run this file again.
    pause
    exit /b 1
  )
  set "PY=python"
)

if exist "%~dp0.hf-s2s-env\Scripts\python.exe" (
  "%~dp0.hf-s2s-env\Scripts\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,11) else 1)" >nul 2>&1
  if errorlevel 1 (
    echo Existing HF environment is not Python 3.11. Recreating it...
    rmdir /s /q "%~dp0.hf-s2s-env"
  )
)

if not exist "%~dp0.hf-s2s-env\Scripts\python.exe" (
  echo Creating Python 3.11 Hugging Face speech-to-speech environment...
  %PY% -m venv "%~dp0.hf-s2s-env"
  if errorlevel 1 goto :fail
)

set "PYTHON=%~dp0.hf-s2s-env\Scripts\python.exe"

echo Installing Hugging Face Speech-to-Speech + Kokoro...\necho Using Python 3.11 to avoid Windows dependency conflicts...
"%PYTHON%" -m pip install --upgrade pip
if errorlevel 1 goto :fail
"%PYTHON%" -m pip install -r "%~dp0requirements-huggingface-s2s.txt"
if errorlevel 1 goto :fail

echo.
echo ==========================================================
echo STARTING LOCAL SPEECH-TO-SPEECH
echo ==========================================================
echo.
echo Speak normally.
echo The agent is instructed to repeat what you say.
echo Kokoro female voice: af_heart
echo.
echo If the first startup takes a while, that is model loading.
echo.

"%PYTHON%" -m speech_to_speech.cli local ^
  --stt parakeet-tdt ^
  --stt_device cpu ^
  --llm_backend transformers ^
  --model_name Qwen/Qwen2.5-0.5B-Instruct ^
  --llm_device cpu ^
  --llm_torch_dtype float32 ^
  --llm_gen_max_new_tokens 96 ^
  --tts kokoro ^
  --kokoro_device cpu ^
  --kokoro_voice af_heart ^
  --init_chat_prompt "You are a realtime voice repeater. Repeat the user's spoken words exactly and naturally. Do not answer questions, add information, summarize, explain, or greet. Output only the words the user said." ^
  --enable_live_transcription

goto :eof

:fail
echo.
echo ==========================================================
echo SETUP FAILED
echo ==========================================================
echo.
pause
exit /b 1
