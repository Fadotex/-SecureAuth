$ErrorActionPreference = 'Stop'

$serverDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $serverDirectory '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
  throw 'server/.env was not found. Configure the server before installing its backup task.'
}

$nodeCommand = Get-Command node -ErrorAction Stop
$nodePath = $nodeCommand.Source
$backupScript = Join-Path $PSScriptRoot 'backup-supabase-users.js'
$taskName = 'SecureAuth Supabase Users Backup'
$action = New-ScheduledTaskAction -Execute $nodePath -Argument "`"$backupScript`"" -WorkingDirectory $serverDirectory
$trigger = New-ScheduledTaskTrigger -Daily -At '2:00 AM'
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Creates a daily encrypted snapshot of SecureAuth public.users in the local ignored backup folder.' -Force | Out-Null

Write-Host "Scheduled '$taskName' daily at 2:00 AM. It runs when this Windows account is signed in and the computer is available."
Write-Host "To inspect or remove it, open Task Scheduler and find '$taskName'."
