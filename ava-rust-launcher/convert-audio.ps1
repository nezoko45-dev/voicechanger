$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$cli = Join-Path $root 'vc-rs.exe'
$gui = Join-Path $root 'vc-gui.exe'
$assets = Join-Path $root 'assets'
$tempWav = $null
function Pick-File($title, $filter) {
  $d = New-Object System.Windows.Forms.OpenFileDialog
  $d.Title = $title; $d.Filter = $filter; $d.Multiselect = $false
  if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $d.FileName }
  return $null
}
function Pick-SaveFile($title, $name) {
  $d = New-Object System.Windows.Forms.SaveFileDialog
  $d.Title = $title; $d.Filter = 'WAV audio (*.wav)|*.wav'; $d.FileName = $name; $d.OverwritePrompt = $true
  if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $d.FileName }
  return $null
}
try {
  if (-not (Test-Path $cli)) { throw 'vc-rs.exe missing. Extract the complete vc-rs Windows ML GUI + CLI ZIP here, keeping all DLLs beside the EXEs.' }
  [System.Windows.Forms.MessageBox]::Show('Choose an RVC model. ONNX is ready. Supported PTH checkpoints must first be converted in the GUI.','RVC audio converter') | Out-Null
  $model = Pick-File 'Select RVC voice model' 'RVC models (*.onnx;*.pth)|*.onnx;*.pth|All files (*.*)|*.*'
  if (-not $model) { exit 0 }
  if ([IO.Path]::GetExtension($model).ToLowerInvariant() -eq '.pth') {
    if (-not (Test-Path $gui)) { throw 'vc-gui.exe is missing. Extract the complete GUI + CLI package.' }
    [System.Windows.Forms.MessageBox]::Show('vc-rs converts supported RVC v2/F0 .pth checkpoints in its GUI. The GUI will open. Browse to the PTH model and let it create an ONNX file beside it. Then run this BAT again and select that ONNX file.','Convert PTH model first') | Out-Null
    Start-Process -FilePath $gui -WorkingDirectory $root
    exit 0
  }
  $inputFile = Pick-File 'Choose speech audio (WAV or MP3)' 'Audio files (*.wav;*.mp3)|*.wav;*.mp3'
  if (-not $inputFile) { exit 0 }
  $embedder = Join-Path $assets 'content_vec_500.onnx'
  $f0model = Join-Path $assets 'rmvpe.onnx'
  if (-not (Test-Path $embedder)) { $embedder = Pick-File 'Select ContentVec embedder ONNX' 'ONNX model (*.onnx)|*.onnx' }
  if (-not $embedder) { throw 'ContentVec embedder was not selected.' }
  if (-not (Test-Path $f0model)) { $f0model = Pick-File 'Select RMVPE F0 ONNX model' 'ONNX model (*.onnx)|*.onnx' }
  if (-not $f0model) { throw 'RMVPE F0 model was not selected.' }
  $outputFile = Pick-SaveFile 'Save converted audio' ([IO.Path]::GetFileNameWithoutExtension($inputFile) + '_converted.wav')
  if (-not $outputFile) { exit 0 }
  $wavInput = $inputFile
  if ([IO.Path]::GetExtension($inputFile).ToLowerInvariant() -eq '.mp3') {
    $ffmpegDir = Join-Path $root '.tools\ffmpeg'
    $ffmpeg = Join-Path $ffmpegDir 'ffmpeg.exe'
    if (-not (Test-Path $ffmpeg)) {
      Write-Host 'Downloading portable FFmpeg for MP3 decoding...'
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $toolsDir = Join-Path $root '.tools'
      New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
      $zip = Join-Path $toolsDir 'ffmpeg-essentials.zip'
      $extract = Join-Path $toolsDir 'ffmpeg-extract'
      Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $zip
      if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
      Expand-Archive -Path $zip -DestinationPath $extract -Force
      $found = Get-ChildItem -Path $extract -Filter ffmpeg.exe -Recurse | Select-Object -First 1
      if (-not $found) { throw 'FFmpeg archive did not contain ffmpeg.exe.' }
      New-Item -ItemType Directory -Force -Path $ffmpegDir | Out-Null
      Get-ChildItem -Path $found.DirectoryName -File | Copy-Item -Destination $ffmpegDir -Force
      Remove-Item $zip -Force -ErrorAction SilentlyContinue
      Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
    }
    $tempWav = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString() + '.wav')
    & $ffmpeg -hide_banner -loglevel error -y -i $inputFile -vn -ac 1 -ar 40000 -c:a pcm_s16le $tempWav
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tempWav)) { throw 'FFmpeg could not decode this MP3.' }
    $wavInput = $tempWav
  }
  Write-Host 'Running RVC conversion...'
  & $cli wav --model $model --embedder $embedder --f0-model $f0model --input $wavInput --output $outputFile --provider windowsml --speaker-id 0
  if ($LASTEXITCODE -ne 0) { throw "vc-rs conversion failed (exit code $LASTEXITCODE). Check that all three ONNX models are compatible." }
  $msg = 'Conversion complete!' + [Environment]::NewLine + [Environment]::NewLine + $outputFile
  [System.Windows.Forms.MessageBox]::Show($msg,'RVC conversion complete') | Out-Null
  Start-Process explorer.exe -ArgumentList ('/select,"' + $outputFile + '"')
}
catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'RVC audio conversion error',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  Write-Host $_
  Read-Host 'Press Enter to close'
}
finally {
  if ($tempWav -and (Test-Path $tempWav)) { Remove-Item $tempWav -Force -ErrorAction SilentlyContinue }
}
