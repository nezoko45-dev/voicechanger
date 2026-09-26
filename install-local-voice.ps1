$ErrorActionPreference="Stop"
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
$Tools=Join-Path $Root "local_voice"
$Models=Join-Path $Tools "models"
$Voices=Join-Path $Tools "voices"
$Downloads=Join-Path $Tools "downloads"
New-Item -ItemType Directory -Force -Path $Tools,$Models,$Voices,$Downloads | Out-Null

function Download($url,$path){
  if(Test-Path $path){Write-Host "Already have $(Split-Path $path -Leaf)";return}
  Write-Host "Downloading $(Split-Path $path -Leaf)..."
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $path
}

$whisperZip=Join-Path $Downloads "whisper-bin-x64.zip"
$piperZip=Join-Path $Downloads "piper_windows_amd64.zip"
$model=Join-Path $Models "ggml-tiny.en-q5_1.bin"
$voice=Join-Path $Voices "en_US-amy-medium.onnx"
$config=Join-Path $Voices "en_US-amy-medium.onnx.json"

Download "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip" $whisperZip
Download "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip" $piperZip
Download "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin?download=true" $model
Download "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx?download=true" $voice
Download "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json?download=true" $config

$whisperDir=Join-Path $Tools "whisper"
$piperDir=Join-Path $Tools "piper"
New-Item -ItemType Directory -Force -Path $whisperDir,$piperDir | Out-Null

if(-not(Get-ChildItem -Path $whisperDir -Recurse -Filter "whisper-cli.exe" -ErrorAction SilentlyContinue)){
  Expand-Archive -Force $whisperZip $whisperDir
}
if(-not(Get-ChildItem -Path $piperDir -Recurse -Filter "piper.exe" -ErrorAction SilentlyContinue)){
  Expand-Archive -Force $piperZip $piperDir
}

$w=Get-ChildItem -Path $whisperDir -Recurse -Filter "whisper-cli.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$p=Get-ChildItem -Path $piperDir -Recurse -Filter "piper.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if(-not $w){throw "whisper-cli.exe was not found after extraction."}
if(-not $p){throw "piper.exe was not found after extraction."}

$edata=Get-ChildItem -Path $piperDir -Recurse -Directory -Filter "espeak-ng-data" -ErrorAction SilentlyContinue | Select-Object -First 1
if($edata -and -not(Test-Path (Join-Path $p.Directory.FullName "espeak-ng-data"))){
  Copy-Item -Recurse $edata.FullName (Join-Path $p.Directory.FullName "espeak-ng-data")
}

Write-Host ""
Write-Host "LOCAL VOICE STACK READY"
Write-Host "Whisper: $($w.FullName)"
Write-Host "Piper:   $($p.FullName)"
Write-Host "Model:   $model"
Write-Host "Voice:   $voice"
