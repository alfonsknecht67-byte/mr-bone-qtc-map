$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$refreshScript = Join-Path $PSScriptRoot 'refresh-funded-map.ps1'
$taskName = 'MrBoneQtcFundedMapRefresh'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$refreshScript`"" `
  -WorkingDirectory $repoRoot

$repeating = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(5) `
  -RepetitionInterval (New-TimeSpan -Hours 6) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger @($repeating, $atLogon) `
  -Principal $principal `
  -Settings $settings `
  -Description 'Refresh and publish the funded QTC address map when the local scanner indexes a new block.' `
  -Force | Out-Null

Write-Output "Installed scheduled task '$taskName' for $currentUser (at logon and every 6 hours)."
