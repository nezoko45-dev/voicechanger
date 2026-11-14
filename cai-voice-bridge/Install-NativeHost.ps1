$ErrorActionPreference = "Stop"
$extensionId = Read-Host "Paste the CAI Voice Bridge extension ID from chrome://extensions"
if ($extensionId -notmatch '^[a-p]{32}$') { throw "That does not look like a Chrome extension ID (32 letters a-p)." }
$exe = Join-Path $PSScriptRoot "CaiVoiceBridge.exe"
if (!(Test-Path $exe)) { throw "CaiVoiceBridge.exe is missing beside this installer." }
$manifest = Join-Path $PSScriptRoot "org.cai.voicebridge.json"
@{
  name = "org.cai.voicebridge"
  description = "CAI Voice Bridge native messaging host"
  path = $exe
  type = "stdio"
  allowed_origins = @("chrome-extension://$extensionId/")
} | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $manifest
New-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\org.cai.voicebridge" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\org.cai.voicebridge" -Name "(default)" -Value $manifest
Write-Host "Installed! Load the extension folder in Chrome, then click it > Start listening." -ForegroundColor Green
