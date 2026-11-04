$ErrorActionPreference = 'Stop'
$panelRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$runtimePath = Join-Path $panelRoot '.runtime'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
$supervisorPath = Join-Path $panelRoot 'scripts\start-quarterly.mjs'
$launchId = [guid]::NewGuid().ToString('N').Substring(0,8)
$panelProcess = Start-Process -FilePath $nodePath -ArgumentList @('--env-file-if-exists=.env',('"' + $supervisorPath + '"')) -WorkingDirectory $panelRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath "supervisor-$launchId.stdout.log") -RedirectStandardError (Join-Path $runtimePath "supervisor-$launchId.stderr.log") -PassThru
Write-Output "KPI supervisor started: $($panelProcess.Id)"
