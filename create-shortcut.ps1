param(
  [string]$DesktopOverride
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopPath = if ($DesktopOverride) { $DesktopOverride } else { [Environment]::GetFolderPath("Desktop") }

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut((Join-Path $DesktopPath "Jai Durga ERP.lnk"))
$Shortcut.TargetPath = Join-Path $ScriptDir "start-erp.bat"
$Shortcut.WorkingDirectory = $ScriptDir
$Shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,109"
$Shortcut.Description = "Launch Jai Durga ERP"
$Shortcut.Save()

Write-Host "Desktop shortcut created at $DesktopPath\Jai Durga ERP.lnk"
