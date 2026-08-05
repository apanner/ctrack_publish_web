#Requires -Version 5.1
<#
  Ensure better-sqlite3 loads under the embedded node.exe shipped in release\runtime.
  Run after scripts\embed-node.ps1.
#>
param(
  [string]$ReleaseRoot = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if ($ReleaseRoot) {
  $releaseRoot = Resolve-Path $ReleaseRoot
} else {
  $releaseRoot = Join-Path $repoRoot "release"
}

$nodeExe = Join-Path $releaseRoot "runtime\node.exe"
$engineDir = Join-Path $releaseRoot "engine"
$betterSqliteDir = Join-Path $engineDir "node_modules\better-sqlite3"

if (-not (Test-Path $nodeExe)) {
  throw ('Missing embedded node.exe at ' + $nodeExe + ' - run scripts\embed-node.ps1 first.')
}
if (-not (Test-Path $betterSqliteDir)) {
  throw ('Missing better-sqlite3 at ' + $betterSqliteDir + ' - run scripts\build-release.bat first.')
}

function Test-BetterSqliteLoad {
  param([string]$Node, [string]$Engine)
  Push-Location $Engine
  try {
    & $Node -e "require('better-sqlite3'); console.log('[ctrack] better-sqlite3 load OK')"
    return ($LASTEXITCODE -eq 0)
  } finally {
    Pop-Location
  }
}

$nodeVersion = & $nodeExe -p "process.versions.node"
Write-Host "[ctrack] Verifying native modules for embedded Node v$nodeVersion ..."

if (Test-BetterSqliteLoad -Node $nodeExe -Engine $engineDir) {
  Write-Host "[ctrack] Native module verification complete."
  exit 0
}

Write-Host "[ctrack] better-sqlite3 failed to load - rebuilding with npm ..."
Push-Location $engineDir
try {
  npm rebuild better-sqlite3 --build-from-source
  if ($LASTEXITCODE -ne 0) {
    throw "npm rebuild better-sqlite3 failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

if (-not (Test-BetterSqliteLoad -Node $nodeExe -Engine $engineDir)) {
  throw "better-sqlite3 still failed to load under embedded Node after rebuild"
}

Write-Host "[ctrack] Native module rebuild complete."
