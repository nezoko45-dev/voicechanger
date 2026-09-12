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

function Find-DeviceInstaller {
  $file = Join-Path $PSScriptRoot 'VoiceChangerDeviceInstaller.exe'
  if (-not (Test-Path $file)) {
    throw "VoiceChanger device installer is missing: $file"
  }
  return $file
}

function Get-DriverDevices {
  try {
    return @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
      Where-Object {
        $_.InstanceId -like 'ROOT\\VirtualAudioDriver*' -or
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
    $installer = Find-DeviceInstaller
    Write-Host "Creating VoiceChanger ROOT device and installing driver from $inf"

    & $installer $inf 2>&1 | ForEach-Object { Write-Host $_ }
    $installerExit = $LASTEXITCODE
    if ($installerExit -notin @(0, 3010)) {
      throw "VoiceChanger device installer failed with exit code $installerExit"
    }

    Scan-Devices
    Start-Sleep -Seconds 3

    $devices = @(Get-DriverDevices)
    if ($devices.Count -gt 0) {
      Write-Host 'VC_STATUS=installed'
      $devices | Format-Table -AutoSize
      break
    }

    if (Test-DriverPackage -InfPath $inf) {
      Write-Host 'VC_STATUS=staged'
      Write-Host 'The signed driver package is present, but Windows has not started the virtual device yet.'
      break
    }

    Write-Host 'VC_STATUS=missing'
    throw 'VoiceChanger ROOT device creation completed, but Windows did not expose the driver device.'
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
      Write-Host 'Driver package is installed, but the ROOT virtual audio device is not currently present.'
      break
    }

    Write-Host 'VC_STATUS=missing'
    exit 2
  }

  default {
    throw "Unknown action '$action'. Use install, uninstall, or status."
  }
}
