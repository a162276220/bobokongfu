param(
  [Parameter(Mandatory=$true)][string]$TextFile,
  [Parameter(Mandatory=$true)][string]$OutFile
)
Add-Type -AssemblyName System.Speech
$text = [System.IO.File]::ReadAllText($TextFile, [System.Text.Encoding]::UTF8)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
if (-not $voice) { throw 'No zh-CN voice installed' }
$synth.SelectVoice($voice.VoiceInfo.Name)
$synth.Rate = 0
$synth.Volume = 100
$synth.SetOutputToWaveFile($OutFile)
$synth.Speak($text)
$synth.Dispose()
