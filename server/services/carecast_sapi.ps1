# CareCast - last-resort announcement voice: Windows built-in Korean voice (SAPI, e.g. "Microsoft Heami").
# Called by server/services/ttsEngines/sapi.js. Fixed script file (not written to %TEMP% each time:
# antivirus re-scans new scripts there - same reason as carecast_mci_play.py).
# ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less files as ANSI.
#
# Args: -In <utf-8 text file> -Out <wav path> -Rate <-10..10>
# Exit: 0 ok, 3 = no enabled ko-KR voice (permanent), other = failure
param([string]$In, [string]$Out, [int]$Rate = 0)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $v = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ko-KR' } | Select-Object -First 1
  if (-not $v) { exit 3 }
  $s.SelectVoice($v.VoiceInfo.Name)
  $s.Rate = [Math]::Max(-10, [Math]::Min(10, $Rate))
  # Same format as Supertonic output: 44100 Hz, 16-bit, mono PCM.
  $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $s.SetOutputToWaveFile($Out, $fmt)
  $s.Speak([System.IO.File]::ReadAllText($In, [System.Text.Encoding]::UTF8))
  $s.SetOutputToNull()
} finally {
  $s.Dispose()
}
exit 0
