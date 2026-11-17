$ErrorActionPreference = 'Stop'
$appRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$launcher = Join-Path $appRoot 'carecast-start.bat'
$nodePath = Join-Path $appRoot 'runtime\node\node.exe'
# Stop only this installation, never every node.exe or an unrelated port owner.
# The supervisor must stop first, otherwise it starts Node again during upgrade.
$processes = @(Get-CimInstance Win32_Process)
$supervisors = @($processes | Where-Object {
  $_.Name -ieq 'cmd.exe' -and $_.CommandLine -and
  $_.CommandLine.IndexOf(('"' + $launcher + '"'), [StringComparison]::OrdinalIgnoreCase) -ge 0
})
foreach ($item in $supervisors) {
  Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
}
$servers = @($processes | Where-Object { $_.ExecutablePath -ieq $nodePath })
foreach ($item in $servers) {
  Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
}
# Close the broadcast screen too (user report 2026-09-17, "window keeps coming back").
# Only Edge windows using THIS installation's profile folder - never the staff member's own Edge.
$profileDir = Join-Path $appRoot 'browser-profile'
$screens = @($processes | Where-Object {
  $_.Name -ieq 'msedge.exe' -and $_.CommandLine -and
  $_.CommandLine.IndexOf($profileDir, [StringComparison]::OrdinalIgnoreCase) -ge 0
})
foreach ($item in $screens) {
  Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 300
$remaining = @(Get-CimInstance Win32_Process | Where-Object {
  ($_.ExecutablePath -ieq $nodePath) -or
  ($_.Name -ieq 'cmd.exe' -and $_.CommandLine -and
   $_.CommandLine.IndexOf(('"' + $launcher + '"'), [StringComparison]::OrdinalIgnoreCase) -ge 0)
})
if ($remaining.Count -gt 0) { throw 'CareCast is still running. Close it before installing or removing it.' }
