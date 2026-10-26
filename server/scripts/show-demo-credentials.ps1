$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Security
$directory = Join-Path $env:LOCALAPPDATA 'SecureAuth'
$credentialFile = Get-ChildItem -LiteralPath $directory -Filter 'demo-credentials-*.dpapi' -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

if (-not $credentialFile) {
    throw 'No protected demo credential bundle was found for this Windows user.'
}

$protectedBytes = [IO.File]::ReadAllBytes($credentialFile.FullName)
$clearBytes = [Security.Cryptography.ProtectedData]::Unprotect($protectedBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$credentials = [Text.Encoding]::UTF8.GetString($clearBytes) | ConvertFrom-Json

Write-Output "Demo credentials (one-time passwords; file: $($credentialFile.Name))"
$credentials | ForEach-Object {
    Write-Output ("{0} ({1}): {2}" -f $_.email, $_.role, $_.password)
}

Remove-Item -LiteralPath $credentialFile.FullName -Force
Write-Output 'The protected handoff was deleted after display. Change every temporary password at first sign-in.'
