<#
Push Edge Function secrets to Supabase from ctrack_publish_web/.env.

Installer downloads use GitHub Releases (GITHUB_RELEASE_TOKEN).
Legacy S3/MinIO secrets are optional — only needed for older releases still on S3.

Usage:
  npm run deploy:edge:secrets
#>

param(
  [string]$ProjectRef,
  [string]$SupabaseWorkdir = $(Join-Path $PSScriptRoot ".."),
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "load-deploy-env.ps1")
Import-CtrackDeployEnv | Out-Null

if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
  $ProjectRef = $env:SUPABASE_PROJECT_REF
}

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_ACCESS_TOKEN)) {
  throw "Missing SUPABASE_ACCESS_TOKEN in .env (needed for supabase secrets set)"
}

if ([string]::IsNullOrWhiteSpace($env:SUPABASE_SERVICE_ROLE_KEY)) {
  throw "Missing SUPABASE_SERVICE_ROLE_KEY in .env (or ctrack_v0/.env.local)"
}

$githubToken = $env:GITHUB_RELEASE_TOKEN
if ([string]::IsNullOrWhiteSpace($githubToken)) {
  $githubToken = $env:GITHUB_TOKEN
}
if ([string]::IsNullOrWhiteSpace($githubToken)) {
  throw "Missing GITHUB_RELEASE_TOKEN (or GITHUB_TOKEN) in .env — needed for engine-download GitHub asset URLs"
}

$secretLines = @(
  "SUPABASE_SERVICE_ROLE_KEY=$($env:SUPABASE_SERVICE_ROLE_KEY)",
  "GITHUB_RELEASE_TOKEN=$githubToken"
)

$githubRepo = $env:GITHUB_REPOSITORY
if ([string]::IsNullOrWhiteSpace($githubRepo)) {
  $ghRepo = gh repo view --json nameWithOwner -q .nameWithOwner 2>$null
  if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($ghRepo)) {
    $githubRepo = $ghRepo.Trim()
  }
}
if (-not [string]::IsNullOrWhiteSpace($githubRepo)) {
  $secretLines += "GITHUB_REPOSITORY=$githubRepo"
}

$optionalAws = @(
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "AWS_S3_BUCKET"
)
$hasAws = $true
foreach ($name in $optionalAws) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    $hasAws = $false
    break
  }
}
if ($hasAws) {
  foreach ($name in $optionalAws) {
    $secretLines += "$name=$([Environment]::GetEnvironmentVariable($name))"
  }
  Write-Host "`[edge-secrets`] Including legacy AWS S3 secrets (older releases on S3)"
} else {
  Write-Host "`[edge-secrets`] Skipping AWS S3 secrets (GitHub Releases is the primary installer host)"
}

$optionalHybrid = @(
  "HYBRID_STORAGE_PRIMARY_ENDPOINT",
  "HYBRID_STORAGE_PRIMARY_BUCKET",
  "HYBRID_STORAGE_PRIMARY_ACCESS_KEY",
  "HYBRID_STORAGE_PRIMARY_SECRET_KEY",
  "HYBRID_STORAGE_PRIMARY_REGION"
)
foreach ($name in $optionalHybrid) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    $secretLines += "$name=$value"
  }
}

$tempFile = Join-Path $env:TEMP ("ctrack-edge-secrets-{0}.env" -f [Guid]::NewGuid().ToString("N"))
try {
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($tempFile, ($secretLines -join [Environment]::NewLine), $utf8NoBom)

  $workdir = (Resolve-Path -LiteralPath $SupabaseWorkdir).Path
  Write-Host "`[edge-secrets`] Project ref: $ProjectRef"
  Write-Host "`[edge-secrets`] Setting GitHub release token + Supabase service role"
  Write-Host "`[edge-secrets`] Note: SUPABASE_URL is auto-injected by Supabase"

  Push-Location $workdir
  try {
    npx --yes supabase@latest secrets set --env-file $tempFile --project-ref $ProjectRef
    if ($LASTEXITCODE -ne 0) {
      throw "supabase secrets set failed (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }

  Write-Host "`[edge-secrets`] Done."
} finally {
  if (Test-Path -LiteralPath $tempFile) {
    Remove-Item -LiteralPath $tempFile -Force
  }
}
