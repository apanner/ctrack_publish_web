<#
Local dev build — compile engine + web without publishing.

Usage:
  powershell -File scripts/deploy-dev.ps1
  powershell -File scripts/deploy-dev.ps1 -Installer
  powershell -File scripts/deploy-dev.ps1 -ReleaseFolder
#>

param(
  [switch]$Installer,
  [switch]$ReleaseFolder,
  [switch]$Install
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $repoRoot
try {
  if ($Install) {
    Write-Host "[deploy-dev] npm install (workspace)..."
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  }

  Write-Host "[deploy-dev] Building engine + web..."
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

  if ($ReleaseFolder) {
    Write-Host "[deploy-dev] Staging release folder..."
    & (Join-Path $repoRoot "scripts\build-release.bat") /nopause
    if ($LASTEXITCODE -ne 0) { throw "build-release.bat failed" }
  }

  if ($Installer) {
    Write-Host "[deploy-dev] Building engine installer..."
    & (Join-Path $repoRoot "scripts\build-installer.bat")
    if ($LASTEXITCODE -ne 0) { throw "build-installer.bat failed" }

    $nukeRoot = (Resolve-Path (Join-Path $repoRoot "..\ctrack_nuke")).Path
    Write-Host "[deploy-dev] Building Nuke installer..."
    & (Join-Path $nukeRoot "installer\build-installer.bat")
    if ($LASTEXITCODE -ne 0) { throw "Nuke build-installer.bat failed" }
  }

  Write-Host "[deploy-dev] Done."
} finally {
  Pop-Location
}
