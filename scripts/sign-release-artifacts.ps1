#Requires -Version 5.1
<#
  Sign release binaries before/after installer compile.
  Called from build-installer.bat and release-publish.ps1 when signing secrets are configured.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$signScript = Join-Path $PSScriptRoot "sign-windows-binary.ps1"

$targets = @()

$nodeExe = Join-Path $repoRoot "release\runtime\node.exe"
if (Test-Path $nodeExe) { $targets += $nodeExe }

$pythonExe = Join-Path $repoRoot "release\engine\runtime\python\python.exe"
if (Test-Path $pythonExe) { $targets += $pythonExe }

$engineSetup = Join-Path $repoRoot "installer\output\CTrackPublishEngine-Setup.exe"
if (Test-Path $engineSetup) { $targets += $engineSetup }

if ($targets.Count -eq 0) {
  Write-Host '[codesign] No release artifacts found to sign.'
  exit 0
}

& $signScript -Path $targets
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
