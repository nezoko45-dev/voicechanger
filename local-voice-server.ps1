param([int]$Port=8908)
$ErrorActionPreference="Stop"
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
$Tools=Join-Path $Root "local_voice"
$Models=Join-Path $Tools "models"
$Voices=Join-Path $Tools "voices"
$Tmp=Join-Path $Tools "tmp"
New-Item -ItemType Directory -Force -Path $Tools,$Models,$Voices,$Tmp | Out-Null

$Whisper=Get-ChildItem -Path $Tools -Recurse -Filter "whisper-cli.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$Piper=Get-ChildItem -Path $Tools -Recurse -Filter "piper.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$WhisperModel=Join-Path $Models "ggml-tiny.en-q5_1.bin"
$PiperModel=Join-Path $Voices "en_US-amy-medium.onnx"

if(-not $Whisper){throw "whisper-cli.exe missing. Run install-local-voice.bat first."}
if(-not $Piper){throw "piper.exe missing. Run install-local-voice.bat first."}
if(-not(Test-Path $WhisperModel)){throw "Whisper model missing. Run install-local-voice.bat first."}
if(-not(Test-Path $PiperModel)){throw "Piper voice model missing. Run install-local-voice.bat first."}

$Page=Join-Path $Root "local-voice.html"
$Q=[char]34

function Send-Bytes($resp,[byte[]]$bytes,[string]$type,[int]$status=200){
  $resp.StatusCode=$status
  $resp.ContentType=$type
  $resp.ContentLength64=$bytes.Length
  $resp.OutputStream.Write($bytes,0,$bytes.Length)
}
function Read-Body($req){
  $ms=New-Object System.IO.MemoryStream
  $req.InputStream.CopyTo($ms)
  $req.InputStream.Close()
  return $ms.ToArray()
}
function Run-Whisper([string]$wav,[string]$outBase){
  $txt=$outBase+".txt"
  if(Test-Path $txt){Remove-Item $txt -Force}
  $psi=New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName=$Whisper.FullName
  $psi.Arguments="-m $Q$WhisperModel$Q -f $Q$wav$Q -l en -nt -np -otxt -of $Q$outBase$Q"
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  $p=New-Object System.Diagnostics.Process
  $p.StartInfo=$psi
  [void]$p.Start()
  $p.WaitForExit()
  if(-not(Test-Path $txt)){return ""}
  return (Get-Content -Raw -LiteralPath $txt).Trim()
}
function Run-Piper([string]$text,[string]$wav){
  if(Test-Path $wav){Remove-Item $wav -Force}
  $psi=New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName=$Piper.FullName
  $psi.Arguments="--model $Q$PiperModel$Q --output_file $Q$wav$Q"
  $psi.UseShellExecute=$false
  $psi.RedirectStandardInput=$true
  $psi.CreateNoWindow=$true
  $p=New-Object System.Diagnostics.Process
  $p.StartInfo=$psi
  [void]$p.Start()
  $p.StandardInput.WriteLine($text)
  $p.StandardInput.Close()
  $p.WaitForExit()
  if(-not(Test-Path $wav)){throw "Piper did not create audio."}
}

$listener=New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Local voice server: http://127.0.0.1:$Port/"
Write-Host "Whisper: $($Whisper.FullName)"
Write-Host "Piper: $($Piper.FullName)"
Write-Host "Press Ctrl+C to stop."

try{
 while($listener.IsListening){
  $ctx=$listener.GetContext()
  try{
   $req=$ctx.Request
   $resp=$ctx.Response
   $path=$req.Url.AbsolutePath
   if($req.HttpMethod -eq "GET" -and ($path -eq "/" -or $path -eq "/local-voice.html")){
    Send-Bytes $resp ([System.IO.File]::ReadAllBytes($Page)) "text/html; charset=utf-8"
   }elseif($req.HttpMethod -eq "GET" -and $path -eq "/health"){
    Send-Bytes $resp ([System.Text.Encoding]::UTF8.GetBytes('{"ok":true,"local":true}')) "application/json; charset=utf-8"
   }elseif($req.HttpMethod -eq "POST" -and $path -eq "/transcribe"){
    $id=[Guid]::NewGuid().ToString("N")
    $wav=Join-Path $Tmp "$id.wav"
    $out=Join-Path $Tmp "$id.out"
    [System.IO.File]::WriteAllBytes($wav,(Read-Body $req))
    $text=Run-Whisper $wav $out
    Remove-Item $wav -Force -ErrorAction SilentlyContinue
    Remove-Item ($out+".txt") -Force -ErrorAction SilentlyContinue
    $json=@{text=$text;local=$true}|ConvertTo-Json -Compress
    Send-Bytes $resp ([System.Text.Encoding]::UTF8.GetBytes($json)) "application/json; charset=utf-8"
   }elseif($req.HttpMethod -eq "POST" -and $path -eq "/speak"){
    $obj=([System.Text.Encoding]::UTF8.GetString((Read-Body $req)))|ConvertFrom-Json
    $text=[string]$obj.text
    if([string]::IsNullOrWhiteSpace($text)){throw "No text supplied."}
    if($text.Length -gt 1000){$text=$text.Substring(0,1000)}
    $wav=Join-Path $Tmp (([Guid]::NewGuid().ToString("N"))+".wav")
    Run-Piper $text $wav
    $bytes=[System.IO.File]::ReadAllBytes($wav)
    Remove-Item $wav -Force -ErrorAction SilentlyContinue
    Send-Bytes $resp $bytes "audio/wav"
   }else{
    Send-Bytes $resp ([System.Text.Encoding]::UTF8.GetBytes("Not found")) "text/plain; charset=utf-8" 404
   }
  }catch{
   $msg=([string]$_.Exception.Message).Replace('\','\\').Replace('"','\"')
   Send-Bytes $ctx.Response ([System.Text.Encoding]::UTF8.GetBytes(('{"ok":false,"error":"'+$msg+'"}'))) "application/json; charset=utf-8" 500
  }finally{try{$ctx.Response.Close()}catch{}}
 }
}finally{$listener.Stop();$listener.Close()}
