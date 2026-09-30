param(
  [Parameter(Mandatory=$true)][string]$PiperExe,
  [Parameter(Mandatory=$true)][string]$Model,
  [int]$Port=8100
)

$ErrorActionPreference='Stop'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Piper bridge listening on http://127.0.0.1:$Port"
Write-Host "Voice: Amy (en_US-amy-medium)"

function Send-Bytes($ctx, [byte[]]$bytes, [int]$status=200, [string]$contentType='audio/wav') {
  $ctx.Response.StatusCode=$status
  $ctx.Response.ContentType=$contentType
  $ctx.Response.Headers.Add('Access-Control-Allow-Origin','*')
  $ctx.Response.Headers.Add('Access-Control-Allow-Methods','POST, OPTIONS')
  $ctx.Response.Headers.Add('Access-Control-Allow-Headers','Content-Type')
  $ctx.Response.ContentLength64=$bytes.Length
  $ctx.Response.OutputStream.Write($bytes,0,$bytes.Length)
  $ctx.Response.OutputStream.Close()
}

while ($listener.IsListening) {
  try {
    $ctx=$listener.GetContext()
    if ($ctx.Request.HttpMethod -eq 'OPTIONS') {
      $ctx.Response.StatusCode=204
      $ctx.Response.Headers.Add('Access-Control-Allow-Origin','*')
      $ctx.Response.Headers.Add('Access-Control-Allow-Methods','POST, OPTIONS')
      $ctx.Response.Headers.Add('Access-Control-Allow-Headers','Content-Type')
      $ctx.Response.Close(); continue
    }
    if ($ctx.Request.Url.AbsolutePath -eq '/health') {
      $b=[Text.Encoding]::UTF8.GetBytes('{"ok":true,"engine":"piper","voice":"en_US-amy-medium"}')
      Send-Bytes $ctx $b 200 'application/json'; continue
    }
    if ($ctx.Request.HttpMethod -ne 'POST' -or $ctx.Request.Url.AbsolutePath -ne '/v1/audio/speech') {
      $b=[Text.Encoding]::UTF8.GetBytes('{"error":"not found"}')
      Send-Bytes $ctx $b 404 'application/json'; continue
    }

    $reader=New-Object IO.StreamReader($ctx.Request.InputStream)
    $body=$reader.ReadToEnd(); $reader.Close()
    $obj=$body | ConvertFrom-Json
    $text=[string]$obj.input
    if ([string]::IsNullOrWhiteSpace($text)) { throw 'Missing input text.' }

    $id=[Guid]::NewGuid().ToString('N')
    $base=Join-Path $env:TEMP "piper_$id"
    $txt="$base.txt"; $wav="$base.wav"
    [IO.File]::WriteAllText($txt,$text,(New-Object Text.UTF8Encoding($false)))

    # Piper accepts text on stdin. Use cmd.exe redirection so the native
    # Piper executable remains untouched and no Python runtime is required.
    $cmd="`"$PiperExe`" --model `"$Model`" --output_file `"$wav`" < `"$txt`""
    $p=Start-Process -FilePath 'cmd.exe' -ArgumentList '/c',$cmd -Wait -PassThru -NoNewWindow
    if ($p.ExitCode -ne 0 -or -not (Test-Path $wav)) { throw "Piper exited with code $($p.ExitCode)." }

    $bytes=[IO.File]::ReadAllBytes($wav)
    Send-Bytes $ctx $bytes 200 'audio/wav'
    Remove-Item $txt,$wav -Force -ErrorAction SilentlyContinue
  } catch {
    try {
      $msg=('{"error":"'+($_.Exception.Message -replace '"','\"')+'"}')
      Send-Bytes $ctx ([Text.Encoding]::UTF8.GetBytes($msg)) 500 'application/json'
    } catch {}
  }
}
$listener.Stop()
