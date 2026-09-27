@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo   OFFLINE Local WAV Voice Agent Setup
echo ==========================================
echo.
echo This setup is STRICTLY OFFLINE.
echo It will NOT use winget, curl, npm, Git, or any
echo other internet download command.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Install Node.js separately before using this offline package.
  echo This setup will not download or install it.
  goto fail
)

node --version

if not exist "node_modules\sherpa-onnx-node" (
  echo ERROR: Bundled dependency is missing:
  echo   node_modules\sherpa-onnx-node
  echo.
  echo This offline package must include node_modules before setup.
  goto fail
)

if not exist "node_modules\ws" (
  echo ERROR: Bundled dependency is missing:
  echo   node_modules\ws
  echo.
  echo This offline package must include node_modules before setup.
  goto fail
)

node -e "require('sherpa-onnx-node'); require('ws'); console.log('Local dependencies OK')"
if errorlevel 1 (
  echo ERROR: A bundled local dependency could not be loaded.
  goto fail
)

if not exist "Recording (10).wav" (
  echo ERROR: Recording (10).wav is missing from the repo folder.
  goto fail
)

if not exist "models\sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20\encoder-epoch-99-avg-1.int8.onnx" (
  echo ERROR: Bundled local STT model is missing.
  echo Expected:
  echo   models\sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20
  goto fail
)

if not exist "models\sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20\decoder-epoch-99-avg-1.onnx" goto missing_asr
if not exist "models\sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20\joiner-epoch-99-avg-1.int8.onnx" goto missing_asr
if not exist "models\sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20\tokens.txt" goto missing_asr

if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\lm_flow.int8.onnx" goto missing_tts
if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\lm_main.int8.onnx" goto missing_tts
if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\encoder.onnx" goto missing_tts
if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\decoder.int8.onnx" goto missing_tts
if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\text_conditioner.onnx" goto missing_tts
if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\vocab.json" goto missing_tts
if not exist "models\sherpa-onnx-pocket-tts-int8-2026-01-26\token_scores.json" goto missing_tts

echo.
echo OFFLINE SETUP CHECK PASSED.
echo No internet connection was used or required.
echo Reference voice: Recording (10).wav
echo.
echo Run start_local.bat to launch the local agent.
pause
exit /b 0

:missing_asr
echo ERROR: One or more bundled STT model files are missing.
goto fail

:missing_tts
echo ERROR: One or more bundled PocketTTS model files are missing.
goto fail

:fail
echo.
echo Offline setup did not pass.
echo Nothing was downloaded, installed, or changed.
pause
exit /b 1
