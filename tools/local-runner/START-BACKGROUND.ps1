param([string]$Config = "$PSScriptRoot\config.local.json")
$ErrorActionPreference = 'Stop'
$nodePath = (Get-Command node).Source
$cliPath = Join-Path $PSScriptRoot 'watchdog.mjs'
$configPath = (Resolve-Path -LiteralPath $Config).Path
$logRoot = Join-Path $env:LOCALAPPDATA 'EMUPERSO-lab\launcher-logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$logTag = [guid]::NewGuid().ToString('N')
$launchArgs = '"{0}" --config "{1}"' -f $cliPath, $configPath
$process = Start-Process -FilePath $nodePath -ArgumentList $launchArgs -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot "$logTag.log") -RedirectStandardError (Join-Path $logRoot "$logTag.err.log") -PassThru
Write-Host "Banc lance sans IA (PID $($process.Id)). Journaux : $logRoot"
Write-Host 'Pause : LAB.bat pause. Arret : LAB.bat stop. Reprise : LAB.bat resume.'
