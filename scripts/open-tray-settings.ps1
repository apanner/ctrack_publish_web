# Open CTrack Engine Settings (Python CustomTkinter) — no console window.
param([string]$InstallRoot = "")

$ErrorActionPreference = "Stop"
$scriptDir = $PSScriptRoot
$vbs = Join-Path $scriptDir "open-tray-settings.vbs"
if (!(Test-Path $vbs)) { throw "Missing $vbs" }
Start-Process -FilePath "wscript.exe" -ArgumentList "//nologo", $vbs -WindowStyle Hidden
