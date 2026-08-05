#Requires -Version 5.1
<#
  Remove Python bytecode caches from release\ before Inno Setup packaging.
  AV tools often block .pyc extraction mid-install (numpy __pycache__ etc).
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

if (-not (Test-Path $releaseRoot)) {
  throw ('Release folder not found: ' + $releaseRoot)
}

$cacheDirs = @(Get-ChildItem -Path $releaseRoot -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue)
foreach ($dir in $cacheDirs) {
  Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue
}

$removedPyc = 0
Get-ChildItem -Path $releaseRoot -Recurse -Include '*.pyc','*.pyo' -File -ErrorAction SilentlyContinue | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path -LiteralPath $_.FullName)) {
    $removedPyc += 1
  }
}

Write-Host ('[ctrack] Stripped ' + $cacheDirs.Count + ' __pycache__ folder(s) and ' + $removedPyc + ' loose .pyc/.pyo file(s) from release payload.')
