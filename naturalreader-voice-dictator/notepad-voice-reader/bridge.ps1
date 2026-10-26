# Notepad Voice Reader bridge — Windows PowerShell 5.1+
# Receives completed sentences from the local browser page and pastes them into Notepad.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://127.0.0.1:8765/')
try { $listener.Start() } catch {
  Write-Host "Could not start local bridge on 127.0.0.1:8765. Close another copy and retry." -ForegroundColor Red
  throw
}
Write-Host 'Notepad Voice Reader bridge is running at http://127.0.0.1:8765/' -ForegroundColor Green
Write-Host 'Leave this window open while dictating. Press Ctrl+C to stop.'
$notepad = Get-Process notepad -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $notepad) {
  Start-Process notepad.exe
  Start-Sleep -Milliseconds 700
  $notepad = Get-Process notepad -ErrorAction SilentlyContinue | Select-Object -First 1
}
while ($listener.IsListening) {
  $context = $null
  try {
    $context = $listener.GetContext()
    $response = $context.Response
    $response.Headers.Add('Access-Control-Allow-Origin','*')
    $response.Headers.Add('Access-Control-Allow-Methods','GET, POST, OPTIONS')
    $response.Headers.Add('Access-Control-Allow-Headers','Content-Type')
    if ($context.Request.HttpMethod -eq 'OPTIONS') {
      $response.StatusCode = 204
    } elseif ($context.Request.Url.AbsolutePath -eq '/health' -and $context.Request.HttpMethod -eq 'GET') {
      $bytes = [Text.Encoding]::UTF8.GetBytes('ok')
      $response.ContentType = 'text/plain; charset=utf-8'
      $response.OutputStream.Write($bytes,0,$bytes.Length)
    } elseif ($context.Request.Url.AbsolutePath -eq '/sentence' -and $context.Request.HttpMethod -eq 'POST') {
      $reader = [IO.StreamReader]::new($context.Request.InputStream, $context.Request.ContentEncoding)
      $sentence = $reader.ReadToEnd()
      $reader.Dispose()
      $sentence = $sentence.Trim()
      if ($sentence.Length -gt 0 -and $sentence.Length -le 5000) {
        Set-Clipboard -Value $sentence
        $notepad = Get-Process notepad -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $notepad) { Start-Process notepad.exe; Start-Sleep -Milliseconds 700; $notepad = Get-Process notepad -ErrorAction SilentlyContinue | Select-Object -First 1 }
        if ($notepad) {
          [Microsoft.VisualBasic.Interaction]::AppActivate($notepad.Id) | Out-Null
          Start-Sleep -Milliseconds 100
          [System.Windows.Forms.SendKeys]::SendWait('^v')
          [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
          $response.StatusCode = 200
          $bytes = [Text.Encoding]::UTF8.GetBytes('ok')
        } else {
          $response.StatusCode = 500
          $bytes = [Text.Encoding]::UTF8.GetBytes('Notepad not found')
        }
        $response.ContentType = 'text/plain; charset=utf-8'
        $response.OutputStream.Write($bytes,0,$bytes.Length)
      } else {
        $response.StatusCode = 400
      }
    } else {
      $response.StatusCode = 404
    }
    $response.Close()
  } catch {
    Write-Host $_.Exception.Message -ForegroundColor Yellow
    if ($context -and $context.Response) { try { $context.Response.StatusCode = 500; $context.Response.Close() } catch {} }
  }
}