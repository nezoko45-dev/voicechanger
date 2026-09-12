$ErrorActionPreference = 'Stop'

function Find-Inf {
  $packageRoot = Join-Path $PSScriptRoot 'package'
  if (-not (Test-Path $packageRoot)) {
    throw "VoiceChanger driver package is missing: $packageRoot"
  }

  $inf = Get-ChildItem -Path $packageRoot -Recurse -Filter '*.inf' -File |
    Where-Object { $_.Name -match 'VirtualAudioDriver|Virtual.*Audio|Audio.*Driver' } |
    Select-Object -First 1

  if (-not $inf) {
    $inf = Get-ChildItem -Path $packageRoot -Recurse -Filter '*.inf' -File | Select-Object -First 1
  }

  if (-not $inf) {
    throw 'No audio driver INF was found in the bundled driver package.'
  }

  return $inf.FullName
}

function Get-DriverDevices {
  $patterns = @('Virtual Audio Driver', 'Virtual Mic Driver', 'VoiceChanger')
  foreach ($pattern in $patterns) {
    try {
      Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
        Where-Object { $_.FriendlyName -like "*$pattern*" } |
        Select-Object Status, Class, FriendlyName, InstanceId
    } catch {
      # PnpDevice is available on supported Windows 10/11 systems; ignore if unavailable.
    }
  }
}

$action = if ($args.Count) { $args[0].ToLowerInvariant() } else { 'status' }

switch ($action) {
  'install' {
    $inf = Find-Inf
    Write-Host "Installing VoiceChanger virtual audio driver from $inf"
    & pnputil.exe /add-driver $inf /install
    if ($LASTEXITCODE -ne 0) {
      throw "pnputil failed with exit code $LASTEXITCODE"
    }
    Write-Host 'VoiceChanger virtual audio driver installation completed.'
    Write-Host 'The driver exposes a virtual speaker and virtual microphone endpoint.'
    break
  }
  'uninstall' {
    $devices = @(Get-DriverDevices)
    $instanceIds = @($devices | ForEach-Object { $_.InstanceId } | Where-Object { $_ })
    foreach ($instanceId in $instanceIds) {
      Write-Host "Removing device $instanceId"
      & pnputil.exe /remove-device $instanceId
    }
    Write-Host 'VoiceChanger virtual audio device removal requested.'
    break
  }
  'status' {
    $devices = @(Get-DriverDevices)
    if ($devices.Count -eq 0) {
      Write-Host 'NOT_INSTALLED'
      exit 2
    }
    $devices | Format-Table -AutoSize
    break
  }
  default {
    throw "Unknown action '$action'. Use install, uninstall, or status."
  }
}
