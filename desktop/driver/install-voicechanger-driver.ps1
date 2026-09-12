$ErrorActionPreference = 'Stop'

function Find-Inf {
  $packageRoot = Join-Path $PSScriptRoot 'package'
  if (-not (Test-Path $packageRoot)) { throw "VoiceChanger driver package is missing: $packageRoot" }
  $inf = Get-ChildItem -Path $packageRoot -Recurse -Filter '*.inf' -File |
    Where-Object { $_.Name -match 'VirtualAudioDriver|Virtual.*Audio|Audio.*Driver' } |
    Select-Object -First 1
  if (-not $inf) { $inf = Get-ChildItem -Path $packageRoot -Recurse -Filter '*.inf' -File | Select-Object -First 1 }
  if (-not $inf) { throw 'No audio driver INF was found in the bundled driver package.' }
  return $inf.FullName
}

function Find-DriverBinary {
  $packageRoot = Join-Path $PSScriptRoot 'package'
  $binary = Get-ChildItem -Path $packageRoot -Recurse -Filter '*.sys' -File | Select-Object -First 1
  if (-not $binary) { throw 'No driver SYS binary was found in the bundled driver package.' }
  return $binary.FullName
}

function Find-DeviceInstaller {
  $file = Join-Path $PSScriptRoot 'VoiceChangerDeviceInstaller.exe'
  if (-not (Test-Path $file)) { throw "VoiceChanger device installer is missing: $file" }
  return $file
}

function Get-VirtualDevices {
  try {
    return @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
      Where-Object {
        $_.InstanceId -like 'ROOT\\VirtualAudioDriver*' -or
        $_.FriendlyName -match 'Virtual Audio Driver|Virtual Mic Driver|VoiceChanger|Magic Mic' -or
        $_.Manufacturer -match 'MikeTheTech|VirtualDrivers'
      } |
      Select-Object Status, Class, FriendlyName, Manufacturer, InstanceId)
  } catch { return @() }
}

function Get-AudioEndpoints {
  try {
    return @(Get-PnpDevice -PresentOnly -Class AudioEndpoint -ErrorAction SilentlyContinue |
      Where-Object {
        $_.FriendlyName -match 'Virtual Audio Driver|Virtual Mic Driver|VoiceChanger|Magic Mic'
      } |
      Select-Object Status, Class, FriendlyName, Manufacturer, InstanceId)
  } catch { return @() }
}

function Set-EndpointName {
  param(
    [Parameter(Mandatory=$true)][object]$Device,
    [Parameter(Mandatory=$true)][string]$Name
  )
  try {
    Set-PnpDeviceProperty -InstanceId $Device.InstanceId -KeyName 'DEVPKEY_Device_FriendlyName' -Type String -Data $Name -ErrorAction Stop
    Write-Host "Renamed audio endpoint to $Name: $($Device.InstanceId)"
    return $true
  } catch {
    Write-Host "WARNING: Could not rename endpoint $($Device.InstanceId) to $Name: $($_.Exception.Message)"
    return $false
  }
}

function Set-MagicMicNames {
  # Rename the parent virtual adapter so Device Manager is branded.
  try {
    foreach ($device in @(Get-VirtualDevices)) {
      try {
        Set-PnpDeviceProperty -InstanceId $device.InstanceId -KeyName 'DEVPKEY_Device_FriendlyName' -Type String -Data 'Magic Mic' -ErrorAction Stop
        Write-Host "Renamed virtual audio device to Magic Mic: $($device.InstanceId)"
      } catch {
        Write-Host "WARNING: Could not rename $($device.InstanceId) to Magic Mic: $($_.Exception.Message)"
      }
    }
  } catch {
    Write-Host "WARNING: Magic Mic parent-device rename failed: $($_.Exception.Message)"
  }

  # Windows exposes the speaker and microphone as separate AudioEndpoint PnP devices.
  # Keep the playback endpoint exactly "Magic Mic" and brand the capture endpoint
  # "Magic Mic Microphone" so Discord/VRChat/etc. can select it as an input.
  $endpoints = @(Get-AudioEndpoints)
  foreach ($endpoint in $endpoints) {
    $isCapture = $endpoint.InstanceId -match '\{0\.0\.1\.'
    if ($isCapture -or $endpoint.FriendlyName -match '(?i)Virtual Mic Driver') {
      Set-EndpointName -Device $endpoint -Name 'Magic Mic Microphone' | Out-Null
    } else {
      Set-EndpointName -Device $endpoint -Name 'Magic Mic' | Out-Null
    }
  }
}

function Test-DriverPackage {
  param([Parameter(Mandatory=$true)][string]$InfPath)
  $infName = Split-Path $InfPath -Leaf
  try {
    $output = & pnputil.exe /enum-drivers /files 2>&1 | Out-String
    return ($output -match [regex]::Escape($infName))
  } catch { return $false }
}

function Test-TestSigning {
  try {
    $output = & bcdedit.exe /enum '{current}' 2>&1 | Out-String
    return ($output -match '(?im)testsigning\s+Yes')
  } catch { return $false }
}

function Enable-TestSigning {
  if (Test-TestSigning) { return $false }
  Write-Host 'Windows Test Signing is required by the bundled Virtual Audio Driver.'
  Write-Host 'Enabling Test Signing mode now. Windows must be restarted before the driver can start.'
  $output = & bcdedit.exe /set testsigning on 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    if ($output -match '(?i)secure boot|boot configuration data|protected by.*secure boot|element data type') {
      throw 'Windows could not enable Test Signing because Secure Boot or boot policy is blocking it. Disable Secure Boot in firmware, restart Windows, then run Install Driver again.'
    }
    throw "Could not enable Windows Test Signing: $($output.Trim())"
  }
  return $true
}

function Trust-DriverSigner {
  param([Parameter(Mandatory=$true)][string]$DriverBinary)
  try {
    $sig = Get-AuthenticodeSignature -FilePath $DriverBinary
    if ($sig.SignerCertificate) {
      Write-Host ("Detected driver signer: " + $sig.SignerCertificate.Subject)
      foreach ($storeName in @('TrustedPublisher', 'Root')) {
        try {
          $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, 'LocalMachine')
          $store.Open('ReadWrite')
          try { $store.Add($sig.SignerCertificate) } finally { $store.Close() }
          Write-Host "Driver signer added to $storeName."
        } catch {
          Write-Host "WARNING: Could not add signer certificate to $storeName: $($_.Exception.Message)"
          Write-Host 'Continuing because Windows Test Signing mode is enabled.'
        }
      }
    } else {
      Write-Host 'WARNING: The bundled driver binary has no readable signer certificate.'
      Write-Host 'Continuing because Windows Test Signing mode is enabled.'
    }
  } catch {
    Write-Host "WARNING: Driver signer inspection failed: $($_.Exception.Message)"
    Write-Host 'Continuing because Windows Test Signing mode is enabled.'
  }
}

function Scan-Devices {
  try { & pnputil.exe /scan-devices 2>&1 | Out-Host } catch { Write-Host "Device scan failed: $($_.Exception.Message)" }
}

function Get-MagicMicEndpointState {
  $endpoints = @(Get-AudioEndpoints)
  $output = @($endpoints | Where-Object { $_.FriendlyName -eq 'Magic Mic' })
  $input = @($endpoints | Where-Object { $_.FriendlyName -eq 'Magic Mic Microphone' })
  return [pscustomobject]@{
    OutputCount = $output.Count
    InputCount = $input.Count
    Output = $output
    Input = $input
  }
}

$action = if ($args.Count) { $args[0].ToLowerInvariant() } else { 'status' }

switch ($action) {
  'install' {
    $inf = Find-Inf
    $driverBinary = Find-DriverBinary
    $installer = Find-DeviceInstaller

    if (Enable-TestSigning) {
      Write-Host 'VC_STATUS=reboot'
      Write-Host 'Windows Test Signing has been enabled. Restart Windows once, then click Install Magic Mic Driver again.'
      break
    }

    Trust-DriverSigner -DriverBinary $driverBinary
    Write-Host "Creating VoiceChanger ROOT device and installing driver from $inf"

    & $installer $inf 2>&1 | ForEach-Object { Write-Host $_ }
    $installerExit = $LASTEXITCODE
    if ($installerExit -notin @(0, 3010)) { throw "VoiceChanger device installer failed with exit code $installerExit" }

    Scan-Devices
    Start-Sleep -Seconds 3
    Set-MagicMicNames
    $state = Get-MagicMicEndpointState
    $devices = @(Get-VirtualDevices)
    if ($state.OutputCount -gt 0 -and $state.InputCount -gt 0) {
      Write-Host 'VC_STATUS=installed'
      Write-Host 'MAGIC_MIC_OUTPUT=Magic Mic'
      Write-Host 'MAGIC_MIC_INPUT=Magic Mic Microphone'
      Write-Host 'Both Magic Mic Windows audio endpoints are present.'
      $state.Output | Format-Table -AutoSize
      $state.Input | Format-Table -AutoSize
      break
    }
    if ($devices.Count -gt 0) {
      Write-Host 'VC_STATUS=staged'
      Write-Host 'The virtual adapter is present, but Windows has not exposed both Magic Mic audio endpoints yet.'
      break
    }
    if (Test-DriverPackage -InfPath $inf) {
      Write-Host 'VC_STATUS=staged'
      Write-Host 'The driver package is present, but Windows has not started the virtual device yet.'
      break
    }
    Write-Host 'VC_STATUS=missing'
    throw 'VoiceChanger ROOT device creation completed, but Windows did not expose the Magic Mic virtual audio device.'
  }

  'uninstall' {
    $devices = @(Get-VirtualDevices)
    $instanceIds = @($devices | ForEach-Object { $_.InstanceId } | Where-Object { $_ })
    foreach ($instanceId in $instanceIds) {
      Write-Host "Removing device $instanceId"
      & pnputil.exe /remove-device $instanceId
    }
    Write-Host 'Magic Mic virtual audio device removal requested.'
    break
  }

  'status' {
    $inf = Find-Inf
    $state = Get-MagicMicEndpointState
    if ($state.OutputCount -gt 0 -and $state.InputCount -gt 0) {
      Set-MagicMicNames
      $state = Get-MagicMicEndpointState
      Write-Host 'VC_STATUS=installed'
      Write-Host 'MAGIC_MIC_OUTPUT=Magic Mic'
      Write-Host 'MAGIC_MIC_INPUT=Magic Mic Microphone'
      Write-Host 'Both Magic Mic Windows audio endpoints are installed.'
      $state.Output | Format-Table -AutoSize
      $state.Input | Format-Table -AutoSize
      break
    }
    if (-not (Test-TestSigning)) {
      Write-Host 'VC_STATUS=testsigning-off'
      Write-Host 'Windows Test Signing is off. The bundled Virtual Audio Driver may show Code 52 until its required signing mode is enabled and Windows is restarted.'
      break
    }
    if (Test-DriverPackage -InfPath $inf) {
      Write-Host 'VC_STATUS=staged'
      Write-Host 'Driver package is installed, but both Magic Mic endpoints are not currently present.'
      break
    }
    Write-Host 'VC_STATUS=missing'
    exit 2
  }

  default { throw "Unknown action '$action'. Use install, uninstall, or status." }
}
