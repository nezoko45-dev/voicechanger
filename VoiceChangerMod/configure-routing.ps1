$ErrorActionPreference = 'Stop'
$file = Join-Path $PSScriptRoot 'Main.cs'
$text = Get-Content -Raw -Path $file

$text = $text.Replace('private const int OutputDeviceIndex = 18;', 'private const string VoicemeeterWindowsName = "VoiceMeeter Input";')
$text = $text.Replace('MelonLogger.Msg("TTS output device index = " + OutputDeviceIndex + " (Voicemeeter Banana target)");', 'MelonLogger.Msg("TTS target: Windows audio device named VoiceMeeter Input (Voicemeeter Banana default input)");')

$startMarker = '    private static void PlayMp3(byte[] audio)'
$endMarker = '    private static void StopPlayback()'
$start = $text.IndexOf($startMarker, [StringComparison]::Ordinal)
$end = $text.IndexOf($endMarker, [StringComparison]::Ordinal)
if ($start -lt 0 -or $end -le $start) { throw 'Could not locate PlayMp3/StopPlayback in Main.cs.' }

$newMethod = @(
'    private static int FindVoicemeeterBananaDevice()',
'    '{',
'        for (int i = 0; i < WaveOut.DeviceCount; i++)',
'        {',
'            try',
'            {',
'                var caps = WaveOut.GetCapabilities(i);',
'                string name = caps.ProductName ?? "";',
'                MelonLogger.Msg("Audio output " + i + ": " + name);',
'                if (name.IndexOf(VoicemeeterWindowsName, StringComparison.OrdinalIgnoreCase) >= 0 &&',
'                    name.IndexOf("AUX", StringComparison.OrdinalIgnoreCase) < 0)',
'                {',
'                    MelonLogger.Msg("Voicemeeter Banana default Windows output found at WaveOut index " + i + ": " + name);',
'                    return i;',
'                }',
'            }',
'            catch (Exception ex)',
'            {',
'                MelonLogger.Warning("Could not inspect audio output " + i + ": " + ex.Message);',
'            }',
'        }',
'        MelonLogger.Error("Voicemeeter Banana default output was not found. Expected a Windows device containing VoiceMeeter Input.");',
'        return -1;',
'    }',
'',
'    private static void PlayMp3(byte[] audio)',
'    {',
'        StopPlayback();',
'        int device = FindVoicemeeterBananaDevice();',
'        if (device < 0)',
'        {',
'            _status = "Voicemeeter Banana output not found";',
'            NativeGui.Refresh();',
'            return;',
'        }',
'        try',
'        {',
'            _audioStream = new MemoryStream(audio, false);',
'            _reader = new Mp3FileReader(_audioStream);',
'            _speaker = new WaveOutEvent { DeviceNumber = device };',
'            MelonLogger.Msg("Playing TTS through VoiceMeeter Input at WaveOut index " + device + ".");',
'            _speaker.Init(_reader);',
'            _speaker.PlaybackStopped += (_, _) => { try { _speaker?.Dispose(); } catch { } try { _reader?.Dispose(); } catch { } try { _audioStream?.Dispose(); } catch { } _speaker = null; _reader = null; _audioStream = null; };',
'            _speaker.Play();',
'        }',
'        catch (Exception ex)',
'        {',
'            MelonLogger.Error("Could not play TTS through Voicemeeter Banana: " + ex.GetType().Name + ": " + ex.Message);',
'            StopPlayback();',
'            _status = "Voicemeeter playback error";',
'            NativeGui.Refresh();',
'        }',
'    }',
'',
'') -join [Environment]::NewLine

$text = $text.Substring(0, $start) + $newMethod + $text.Substring($end)
if ($text.Contains('OutputDeviceIndex')) { throw 'Old numeric output routing remains in Main.cs.' }
if (-not $text.Contains('FindVoicemeeterBananaDevice')) { throw 'Voicemeeter routing was not inserted.' }
Set-Content -Path $file -Value $text -Encoding UTF8
Write-Host 'Voicemeeter Banana Windows-name routing configured.'