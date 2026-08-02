<#
Push required GitHub Actions secrets from ctrack_publish_web/.env (or .env.deploy).

Usage:
  powershell -File scripts/setup-github-deploy-secrets.ps1
  powershell -File scripts/setup-github-deploy-secrets.ps1 -DryRun

Requires: gh auth login with admin access to the repo.
#>

param(
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "load-deploy-env.ps1")
Import-CtrackDeployEnv | Out-Null

$secretMap = [ordered]@{
  SUPABASE_ACCESS_TOKEN = $env:SUPABASE_ACCESS_TOKEN
  SUPABASE_URL = $env:SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY = $env:SUPABASE_SERVICE_ROLE_KEY
}

$githubReleaseToken = $env:GITHUB_RELEASE_TOKEN
if ([string]::IsNullOrWhiteSpace($githubReleaseToken)) {
  $githubReleaseToken = $env:GITHUB_TOKEN
}
if (-not [string]::IsNullOrWhiteSpace($githubReleaseToken)) {
  $secretMap["GITHUB_RELEASE_TOKEN"] = $githubReleaseToken
}

$missing = @()
foreach ($entry in $secretMap.GetEnumerator()) {
  if ([string]::IsNullOrWhiteSpace([string]$entry.Value)) {
    $missing += $entry.Key
  }
}

if ($missing.Count -gt 0) {
  throw ("Missing in .env / .env.deploy: " + ($missing -join ", ") + ". Copy .env.deploy.example and fill values.")
}

$repo = gh repo view --json nameWithOwner -q .nameWithOwner
Write-Host "[github-secrets] Repository: $repo"

foreach ($entry in $secretMap.GetEnumerator()) {
  $name = $entry.Key
  $value = [string]$entry.Value
  if ($DryRun) {
    Write-Host "[github-secrets] (dry-run) would set $name ($($value.Length) chars)"
    continue
  }
  Write-Host "[github-secrets] Setting $name ..."
  $value | gh secret set $name
  if ($LASTEXITCODE -ne 0) {
    throw "gh secret set $name failed"
  }
}

if ($DryRun) {
  Write-Host "[github-secrets] Dry run complete."
} else {
  Write-Host "[github-secrets] Done. Push workflow + tag, or run: npm run deploy:release:remote"
}
