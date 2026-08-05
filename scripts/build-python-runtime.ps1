param(
  [string]$PythonVersion = "3.11.9",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$releaseEngine = Join-Path $repoRoot "release\engine"

if (!(Test-Path $releaseEngine)) {
  throw "Release engine folder does not exist: $releaseEngine. Run scripts\build-release.bat first."
}

$provision = Join-Path $PSScriptRoot "provision-gui-python.ps1"
if ($Force) {
  & $provision -TargetRoot $releaseEngine -PythonVersion $PythonVersion -Force
} else {
  & $provision -TargetRoot $releaseEngine -PythonVersion $PythonVersion
}
if ($LASTEXITCODE -ne 0) { throw "provision-gui-python.ps1 failed" }

Write-Host "[ctrack] Embedding FFmpeg, OpenImageIO, OCIO..."
$ensureScript = Join-Path $PSScriptRoot "ensure-engine-runtime.ps1"
if ($Force) {
  & $ensureScript -TargetRoot $releaseEngine -Force -Provision
} else {
  & $ensureScript -TargetRoot $releaseEngine -Provision
}
if ($LASTEXITCODE -ne 0) { throw "ensure-engine-runtime.ps1 failed" }

$pythonDir = Join-Path $releaseEngine "runtime\python"
Write-Host "[ctrack] Portable Python runtime ready: $pythonDir"
Write-Host "[ctrack] Media runtimes under: $(Join-Path $releaseEngine 'runtime')"
