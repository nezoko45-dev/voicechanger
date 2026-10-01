@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Pocket TTS - Install Local Voice Cloning Weights

echo ==================================================
echo   POCKET TTS LOCAL VOICE-CLONING WEIGHTS SETUP
echo ==================================================
echo.

set "UV_EXE=%USERPROFILE%\.local\bin\uv.exe"
if exist "%UV_EXE%" goto uv_ready
where uv >nul 2>nul
if not errorlevel 1 (
  set "UV_EXE=uv.exe"
  goto uv_ready
)
echo uv was not found. Installing uv...
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
if exist "%USERPROFILE%\.local\bin\uv.exe" set "UV_EXE=%USERPROFILE%\.local\bin\uv.exe"

:uv_ready
if not exist "%UV_EXE%" if /I not "%UV_EXE%"=="uv.exe" (
  echo Could not find uv.exe.
  pause
  exit /b 1
)

if not exist "models\pocket-tts" mkdir "models\pocket-tts"
if not exist "models\tokenizer" mkdir "models\tokenizer"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required by the launcher.
  pause
  exit /b 1
)

echo.
echo Checking Hugging Face login...
"%UV_EXE%"x hf auth whoami >nul 2>nul
if errorlevel 1 goto hf_login

echo Hugging Face login found.
goto download

:hf_login
echo.
echo Pocket TTS voice-cloning weights are gated by Kyutai.
echo You must accept the Pocket TTS model conditions in your browser first:
echo https://huggingface.co/kyutai/pocket-tts
start "" "https://huggingface.co/kyutai/pocket-tts"
echo.
echo After accepting the conditions, this window will ask you to log in.
echo Use a Hugging Face token with access to kyutai/pocket-tts.
echo.
"%UV_EXE%"x hf auth login
if errorlevel 1 (
  echo Hugging Face login failed.
  pause
  exit /b 1
)

:download
echo.
echo Downloading the Pocket TTS voice-cloning model weights...
echo This is a one-time download and is roughly 219 MB for the current English model.
if exist "models\pocket-tts\model.safetensors" goto model_done
"%UV_EXE%"x hf download kyutai/pocket-tts languages/english/model.safetensors --local-dir "models\pocket-tts"
if errorlevel 1 (
  echo.
  echo FAILED: Could not download the gated voice-cloning model.
  echo Make sure you accepted the Kyutai model conditions and logged in.
  pause
  exit /b 1
)
:model_done

echo Downloading the tokenizer used by the English model...
if exist "models\tokenizer\tokenizer.json" goto tokenizer_done
"%UV_EXE%"x hf download kyutai/pocket-tts-without-voice-cloning languages/english/tokenizer.json --local-dir "models\tokenizer"
if errorlevel 1 (
  echo FAILED: Could not download the public tokenizer.
  pause
  exit /b 1
)
:tokenizer_done

>"models\local_english.yaml" echo weights_path: %CD:\=/%/models/pocket-tts/model.safetensors
>>"models\local_english.yaml" echo weights_path_without_voice_cloning: %CD:\=/%/models/pocket-tts/model.safetensors
>>"models\local_english.yaml" echo default_temperature: 0.3
>>"models\local_english.yaml" echo flow_lm:
>>"models\local_english.yaml" echo   insert_bos_before_voice: true
>>"models\local_english.yaml" echo   dtype: float32
>>"models\local_english.yaml" echo   flow:
>>"models\local_english.yaml" echo     depth: 6
>>"models\local_english.yaml" echo     dim: 512
>>"models\local_english.yaml" echo   transformer:
>>"models\local_english.yaml" echo     d_model: 1024
>>"models\local_english.yaml" echo     hidden_scale: 4
>>"models\local_english.yaml" echo     max_period: 10000
>>"models\local_english.yaml" echo     num_heads: 16
>>"models\local_english.yaml" echo     num_layers: 6
>>"models\local_english.yaml" echo   lookup_table:
>>"models\local_english.yaml" echo     dim: 1024
>>"models\local_english.yaml" echo     n_bins: 4000
>>"models\local_english.yaml" echo     tokenizer: tokenizers
>>"models\local_english.yaml" echo     tokenizer_path: %CD:\=/%/models/tokenizer/tokenizer.json
>>"models\local_english.yaml" echo mimi:
>>"models\local_english.yaml" echo   dtype: float32
>>"models\local_english.yaml" echo   sample_rate: 24000
>>"models\local_english.yaml" echo   inner_dim: 32
>>"models\local_english.yaml" echo   outer_dim: 512
>>"models\local_english.yaml" echo   channels: 1
>>"models\local_english.yaml" echo   frame_rate: 12.5
>>"models\local_english.yaml" echo   seanet:
>>"models\local_english.yaml" echo     dimension: 512
>>"models\local_english.yaml" echo     channels: 1
>>"models\local_english.yaml" echo     n_filters: 64
>>"models\local_english.yaml" echo     n_residual_layers: 1
>>"models\local_english.yaml" echo     ratios: [6, 5, 4]
>>"models\local_english.yaml" echo     kernel_size: 7
>>"models\local_english.yaml" echo     residual_kernel_size: 3
>>"models\local_english.yaml" echo     dilation_base: 2
>>"models\local_english.yaml" echo     pad_mode: constant
>>"models\local_english.yaml" echo     compress: 2
>>"models\local_english.yaml" echo     transformer:
>>"models\local_english.yaml" echo       d_model: 512
>>"models\local_english.yaml" echo       num_heads: 8
>>"models\local_english.yaml" echo       num_layers: 2
>>"models\local_english.yaml" echo       layer_scale: 0.01
>>"models\local_english.yaml" echo       context: 250
>>"models\local_english.yaml" echo       dim_feedforward: 2048
>>"models\local_english.yaml" echo       input_dimension: 512
>>"models\local_english.yaml" echo       output_dimensions: [512]
>>"models\local_english.yaml" echo     quantizer:
>>"models\local_english.yaml" echo       dimension: 32
>>"models\local_english.yaml" echo       output_dimension: 512

echo.
echo ==================================================
echo Local Pocket TTS voice-cloning weights are ready.
echo Model: models\pocket-tts\model.safetensors
echo Tokenizer: models\tokenizer\tokenizer.json
echo Config: models\local_english.yaml
echo ==================================================
echo.
pause
