<#
Remove all local build / deploy artifacts. CI builds from a clean checkout — do not commit outputs.

Usage:
  powershell -File scripts/clean-all.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

$targets = @(
  (Join-Path $root "web/dist"),
  (Join-Path $root "engine/dist"),
  (Join-Path $root "engine/dist-bundle"),
  (Join-Path $root "release"),
  (Join-Path $root "Release"),
  (Join-Path $root "out"),
  (Join-Path $root ".vercel"),
  (Join-Path $root "installer/output"),
  (Join-Path $root "ctrack_nuke/installer/output")
)

foreach ($path in $targets) {
  if (Test-Path $path) {
    Write-Host "[clean] Removing $path"
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Get-ChildItem -Path $root -Recurse -Filter "*.tsbuildinfo" -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "[clean] Removing $($_.FullName)"
  Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
}

Write-Host "[clean] Done. Run npm run dev for local development. Do not commit dist/ or release/."
