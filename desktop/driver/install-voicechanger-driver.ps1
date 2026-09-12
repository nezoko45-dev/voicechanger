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
  try {
    return @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
      Where-Object {
        $_.FriendlyName -match 'Virtual Audio Driver|Virtual Mic Driver|VoiceChanger' -or
        $_.Manufacturer -match 'MikeTheTech|VirtualDrivers'
      } |
      Select-Object Status, Class, FriendlyName, Manufacturer, InstanceId)
  } catch {
    return @()
  }
}

function Test-DriverPackage {
  param([Parameter(Mandatory=$true)][string]$InfPath)
  $infName = Split-Path $InfPath -Leaf
  try {
    $output = & pnputil.exe /enum-drivers /files 2>&1 | Out-String
    return ($output -match [regex]::Escape($infName))
  } catch {
    return $false
  }
}

function Scan-Devices {
  try {
    & pnputil.exe /scan-devices 2>&1 | Out-Host
  } catch {
    Write-Host "Device scan failed: $($_.Exception.Message)"
  }
}

$action = if ($args.Count) { $args[0].ToLowerInvariant() } else { 'status' }

switch ($action) {
  'install' {
    $inf = Find-Inf
    Write-Host "Installing VoiceChanger virtual audio driver package from $inf"

    & pnputil.exe /add-driver $inf /install
    if ($LASTEXITCODE -ne 0) {
      throw "pnputil failed with exit code $LASTEXITCODE"
    }

    Scan-Devices
    Start-Sleep -Seconds 2

    $devices = @(Get-DriverDevices)
    if ($devices.Count -gt 0) {
      Write-Host 'VC_STATUS=installed'
      $devices | Format-Table -AutoSize
      break
    }

    if (Test-DriverPackage -InfPath $inf) {
      Write-Host 'VC_STATUS=staged'
      Write-Host 'The signed VoiceChanger driver package is installed in the Windows Driver Store.'
      Write-Host 'Windows did not create the root-enumerated audio device automatically.'
      Write-Host 'Opening the Windows Add Legacy Hardware wizard so the virtual speaker/microphone can be created.'
      try {
        Start-Process -FilePath (Join-Path $env:windir 'System32\hdwwiz.exe') -WindowStyle Normal | Out-Null
      } catch {
        Write-Host "VC_WIZARD_ERROR=$($_.Exception.Message)"
      }
      break
    }

    Write-Host 'VC_STATUS=missing'
    throw 'The VoiceChanger driver package could not be verified in the Windows Driver Store.'
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
    $inf = Find-Inf
    $devices = @(Get-DriverDevices)
    if ($devices.Count -gt 0) {
      Write-Host 'VC_STATUS=installed'
      $devices | Format-Table -AutoSize
      break
    }

    if (Test-DriverPackage -InfPath $inf) {
      Write-Host 'VC_STATUS=staged'
      Write-Host 'Driver package is installed, but the virtual audio endpoints are not currently present.'
      break
    }

    Write-Host 'VC_STATUS=missing'
    exit 2
  }

  default {
    throw "Unknown action '$action'. Use install, uninstall, or status."
  }
}
