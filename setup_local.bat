@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ==========================================
echo   OFFLINE Local WAV Voice Agent Setup
echo ==========================================
echo.
echo OFFLINE MODE: all dependencies and models
echo are copied ONLY from offline_bundle.
echo No winget, curl, npm, Git, or Internet access.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Install Node.js separately. This script will not download it.
  goto fail
)
node --version

if not exist "offline_bundle\node_modules\sherpa-onnx-node" (
  echo ERROR: Missing offline_bundle\node_modules\sherpa-onnx-node
  goto fail
)
if not exist "offline_bundle\node_modules\ws" (
  echo ERROR: Missing offline_bundle\node_modules\ws
  goto fail
)

if not exist "offline_bundle\models\sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20\encoder-epoch-99-avg-1.int8.onnx" (
  echo ERROR: Missing bundled streaming STT model.
  goto fail
)
if not exist "offline_bundle\models\sherpa-onnx-pocket-tts-int8-2026-01-26\lm_flow.int8.onnx" (
  echo ERROR: Missing bundled PocketTTS model.
  goto fail
)
if not exist "offline_bundle\models\sherpa-onnx-pocket-tts-int8-2026-01-26\vocab.json" (
  echo ERROR: Missing bundled PocketTTS vocab.
  goto fail
)

if not exist "Recording (10).wav" (
  echo ERROR: Recording (10).wav is missing from the repo root.
  goto fail
)

echo.
echo Copying bundled Node modules...
if not exist "node_modules" mkdir "node_modules"
robocopy "offline_bundle\node_modules" "node_modules" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo ERROR: Could not copy bundled Node modules.
  goto fail
)

echo Copying bundled speech models...
if not exist "models" mkdir "models"
robocopy "offline_bundle\models" "models" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo ERROR: Could not copy bundled models.
  goto fail
)

echo.
echo Verifying local dependencies...
node -e "require('sherpa-onnx-node'); require('ws'); console.log('Local dependencies OK')"
if errorlevel 1 (
  echo ERROR: Bundled Node modules could not be loaded.
  goto fail
)

echo.
echo Verifying local STT model...
if not exist "models\sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20\encoder-epoch-99-avg-1.int8.onnx" goto missing_asr
if not exist "models\sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20\decoder-epoch-99-avg-1.onnx" goto missing_asr
if not exist "models\sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20\joiner-epoch-99-avg-1.int8.onnx" goto missing_asr
if not exist "models\sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20\tokens.txt" goto missing_asr

echo Verifying local PocketTTS model...
if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\lm_flow.int8.onnx" goto missing_tts
if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\lm_main.int8.onnx" goto missing_tts
if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\encoder.onnx" goto missing_tts
if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\decoder.int8.onnx" goto missing_tts
if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\text_conditioner.onnx" goto missing_tts
if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\vocab.json" goto missing_tts
if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\token_scores.json" goto missing_tts

echo.
echo ==========================================
echo   OFFLINE SETUP COMPLETE
echo ==========================================
echo.
echo Everything was copied from offline_bundle.
echo No Internet connection was used.
echo Reference voice: Recording (10).wav
echo.
echo Run start_local.bat to launch the agent.
pause
exit /b 0

:missing_asr
echo ERROR: The copied STT model is incomplete.
goto fail

:missing_tts
echo ERROR: The copied PocketTTS model is incomplete.
goto fail

:fail
echo.
echo OFFLINE SETUP FAILED.
echo No downloads were attempted.
pause
exit /b 1
