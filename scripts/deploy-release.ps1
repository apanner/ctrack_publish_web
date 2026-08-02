<#
Full production deploy: Edge Functions → build installers → GitHub Release + Supabase engine_releases.

Required env:
  SUPABASE_ACCESS_TOKEN (edge deploy only)
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  GITHUB_TOKEN (or GH_TOKEN) — automatic in GitHub Actions

Usage:
  powershell -File scripts/deploy-release.ps1
  powershell -File scripts/deploy-release.ps1 -SkipBuild -SkipEdge
  powershell -File scripts/deploy-release.ps1 -Channel beta -ReleaseNotes "Fix pairing"
#>

param(
  [switch]$SkipBuild,
  [switch]$SkipEdge,
  [string]$Channel = "stable",
  [string]$ReleaseNotes = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptsDir = $PSScriptRoot
. (Join-Path $scriptsDir "load-deploy-env.ps1")
Import-CtrackDeployEnv | Out-Null

if (-not $SkipEdge) {
  Write-Host "[deploy-release] Step 1/2 — Supabase Edge Functions"
  & (Join-Path $scriptsDir "deploy-edge-functions.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "deploy-edge-functions.ps1 failed"
  }
  if (-not [string]::IsNullOrWhiteSpace($env:SUPABASE_ACCESS_TOKEN)) {
    Write-Host "[deploy-release] Syncing edge secrets (GitHub release token)..."
    & (Join-Path $scriptsDir "sync-edge-secrets.ps1")
    if ($LASTEXITCODE -ne 0) {
      throw "sync-edge-secrets.ps1 failed"
    }
  }
} else {
  Write-Host "[deploy-release] Skipping Edge Functions (-SkipEdge)"
}

Write-Host "[deploy-release] Step 2/2 — Build installers + GitHub Release + engine_releases"
$publishArgs = @{
  Channel = $Channel
  ReleaseNotes = $ReleaseNotes
}
if ($SkipBuild) {
  $publishArgs.SkipBuild = $true
}

& (Join-Path $scriptsDir "release-publish.ps1") @publishArgs
if ($LASTEXITCODE -ne 0) {
  throw "release-publish.ps1 failed"
}

Write-Host "[deploy-release] Production deploy complete."
