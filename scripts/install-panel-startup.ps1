param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$panelRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder 'KPI Quarterly Panel.lnk'
$launcherPath = Join-Path $panelRoot 'scripts\start-panel.ps1'
$launchCommand = "& '" + $launcherPath.Replace("'", "''") + "'"
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($launchCommand))
$description = 'KPI Quarterly Panel startup and recovery for the current Windows user'
function Is-PanelShortcut($link) { return $link.Arguments.Contains($launcherPath) -or $link.Arguments.Contains($encodedCommand) -or $link.Description -eq $description }
if ($Remove) {
    if (Test-Path -LiteralPath $shortcutPath) {
        $existing = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
        if (-not (Is-PanelShortcut $existing)) { throw 'Shortcut belongs to another project.' }
        Remove-Item -LiteralPath $shortcutPath
    }
    Write-Output 'KPI auto-start shortcut removed.'
    exit
}
if (Test-Path -LiteralPath $shortcutPath) {
    $existing = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    if (-not (Is-PanelShortcut $existing)) { throw 'An unrelated startup shortcut already exists.' }
}
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path -LiteralPath $shortcut.TargetPath)) { $shortcut.TargetPath = (Get-Command powershell.exe).Source }
$shortcut.Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand ' + $encodedCommand
$shortcut.WorkingDirectory = $env:SystemRoot
$shortcut.WindowStyle = 7
$shortcut.Description = $description
$shortcut.Save()
$verified = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
if (-not $verified.Arguments.Contains($encodedCommand)) { throw 'Startup shortcut did not preserve the encoded project path.' }
Write-Output "Installed: $shortcutPath"
