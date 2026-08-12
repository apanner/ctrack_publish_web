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
  VITE_SUPABASE_URL = $(if ($env:VITE_SUPABASE_URL) { $env:VITE_SUPABASE_URL } else { $env:SUPABASE_URL })
  VITE_SUPABASE_ANON_KEY = $env:VITE_SUPABASE_ANON_KEY
}

if (-not [string]::IsNullOrWhiteSpace($env:CTRACK_WEB_URL)) {
  $secretMap["CTRACK_WEB_URL"] = $env:CTRACK_WEB_URL
}
if (-not [string]::IsNullOrWhiteSpace($env:CTRACK_AUTH_CALLBACK_URL)) {
  $secretMap["CTRACK_AUTH_CALLBACK_URL"] = $env:CTRACK_AUTH_CALLBACK_URL
}

$githubReleaseToken = $env:GITHUB_RELEASE_TOKEN
if ([string]::IsNullOrWhiteSpace($githubReleaseToken)) {
  $githubReleaseToken = $env:GITHUB_TOKEN
}
if ([string]::IsNullOrWhiteSpace($githubReleaseToken)) {
  $githubReleaseToken = (gh auth token 2>$null)
}
if (-not [string]::IsNullOrWhiteSpace($githubReleaseToken)) {
  $secretMap["CTRACK_GH_TOKEN"] = $githubReleaseToken
}

$missing = @()
$required = @("SUPABASE_ACCESS_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_ANON_KEY")
foreach ($key in $required) {
  if ([string]::IsNullOrWhiteSpace([string]$secretMap[$key])) {
    $missing += $key
  }
}

if ($missing.Count -gt 0) {
  throw ("Missing in .env / .env.deploy: " + ($missing -join ", ") + ". Need VITE_SUPABASE_ANON_KEY to bake engine/.env into the installer.")
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
