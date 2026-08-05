#Requires -Version 5.1
<#
  Rebuild native Node addons in release\engine using the embedded node.exe.
  Run after scripts\embed-node.ps1 so ABI matches the shipped runtime.
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

$nodeVersion = & $nodeExe -p "process.versions.node"
Write-Host "[ctrack] Rebuilding native modules for embedded Node v$nodeVersion ..."

$nodeGyp = Join-Path $engineDir "node_modules\node-gyp\bin\node-gyp.js"
if (-not (Test-Path $nodeGyp)) {
  $nodeGyp = Join-Path $betterSqliteDir "node_modules\node-gyp\bin\node-gyp.js"
}
if (-not (Test-Path $nodeGyp)) {
  throw "node-gyp not found under release\engine\node_modules"
}

Push-Location $betterSqliteDir
try {
  & $nodeExe $nodeGyp rebuild --release
  if ($LASTEXITCODE -ne 0) {
    throw "node-gyp rebuild failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

Push-Location $engineDir
try {
  & $nodeExe -e "require('better-sqlite3'); console.log('[ctrack] better-sqlite3 load OK')"
  if ($LASTEXITCODE -ne 0) {
    throw "better-sqlite3 failed to load under embedded Node"
  }
} finally {
  Pop-Location
}

Write-Host "[ctrack] Native module rebuild complete."
