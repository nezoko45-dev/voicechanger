# Windows-native offline dictation using .NET System.Speech.
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $culture = [System.Globalization.CultureInfo]::GetCultureInfo('en-US')
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine -ArgumentList $culture
  $grammar = New-Object System.Speech.Recognition.DictationGrammar
  $engine.LoadGrammar($grammar)
  $engine.SetInputToDefaultAudioDevice()
  $sync = New-Object object
  $engine.add_SpeechRecognized({
    param($sender, $eventArgs)
    if ($eventArgs.Result -and $eventArgs.Result.Text -and $eventArgs.Result.Confidence -ge 0.25) {
      [System.Threading.Monitor]::Enter($sync)
      try {
        $payload = @{ type = 'result'; text = [string]$eventArgs.Result.Text; confidence = [double]$eventArgs.Result.Confidence } | ConvertTo-Json -Compress
        [Console]::Out.WriteLine($payload)
        [Console]::Out.Flush()
      } finally { [System.Threading.Monitor]::Exit($sync) }
    }
  })
  [Console]::Out.WriteLine('{"type":"status","message":"Windows offline speech recognition is listening."}')
  [Console]::Out.Flush()
  $engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
  while ($true) { Start-Sleep -Milliseconds 250 }
} catch {
  $message = $_.Exception.Message.Replace('"', "'").Replace("`r", ' ').Replace("`n", ' ')
  [Console]::Out.WriteLine(('{"type":"error","message":"' + $message + '"}'))
  [Console]::Out.Flush()
  exit 1
}
