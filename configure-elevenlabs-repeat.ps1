param(
  [Parameter(Mandatory=$true)][string]$AgentId,
  [Parameter(Mandatory=$true)][string]$ApiKey
)

$ErrorActionPreference = "Stop"

$headers = @{
  "xi-api-key" = $ApiKey
  "Content-Type" = "application/json"
}

$agentUrl = "https://api.elevenlabs.io/v1/convai/agents/$AgentId"

Write-Host "Reading agent configuration..."
$agent = Invoke-RestMethod -Method Get -Uri $agentUrl -Headers $headers

Write-Host "Finding Ava in your ElevenLabs voices..."
$voices = Invoke-RestMethod -Method Get -Uri "https://api.elevenlabs.io/v1/voices?search=Ava" -Headers $headers
$ava = @($voices.voices | Where-Object { $_.name -like "Ava*" }) | Select-Object -First 1

if (-not $ava -or -not $ava.voice_id) {
  throw "Could not find an Ava voice in this ElevenLabs account. Open Voices, find Ava, and make sure the voice is available to your account."
}

Write-Host ("Using Ava voice: {0} ({1})" -f $ava.name, $ava.voice_id)

$repeatPrompt = @"
Your only job is to repeat exactly what the user says.

The first message is a one-time introduction: HUMAN!! IM BACK!!

After that introduction:
- Repeat only the user's latest spoken words.
- Preserve the exact words and their order.
- Never answer the user.
- Never ask questions.
- Never say "Are you still there?".
- Never say "How can I help?".
- Never comment on silence or inactivity.
- Never acknowledge the user.
- Never greet again.
- Never repeat or mention your own introduction.
- Never add, remove, summarize, translate, correct, interpret, or change words.
- Never switch to another voice or another character.

Example:
User: hello how are you
Agent: hello how are you
"@

$body = @{
  conversation_config = @{
    agent = @{
      first_message = "HUMAN!! IM BACK!!"
      prompt = @{
        prompt = $repeatPrompt
      }
    }
    turn = @{
      turn_timeout = 5
      silence_end_call_timeout = -1
      soft_timeout_config = @{
        timeout_seconds = -1
        message = ""
      }
    }
    tts = @{
      voice_id = $ava.voice_id
      supported_voices = @()
    }
    conversation = @{
      max_duration_seconds = 7200
    }
  }
} | ConvertTo-Json -Depth 20

Write-Host "Updating ElevenLabs Agent..."
$result = Invoke-RestMethod -Method Patch -Uri $agentUrl -Headers $headers -Body $body

Write-Host ""
Write-Host "SUCCESS!"
Write-Host ("Agent: {0}" -f $result.name)
Write-Host ("Voice: {0}" -f $ava.name)
Write-Host "Repeat-only prompt installed."
Write-Host "Soft timeout disabled."
Write-Host "Additional voices cleared."
Write-Host "Maximum conversation duration set to 2 hours."
