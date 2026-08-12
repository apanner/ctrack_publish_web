<#
Deploy CTrack Publish engine Edge Functions to Supabase.
Loads credentials from ctrack_publish_web/.env (see scripts/load-deploy-env.ps1).
#>

param(
  [string]$ProjectRef,
  [string]$SupabaseWorkdir = $(Join-Path $PSScriptRoot ".."),
  [string[]]$Function = @(
    "engine-pair-init",
    "engine-pair-complete",
    "engine-download",
    "engine-releases-latest",
    "engine-provision"
  ),
  [switch]$Login
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "load-deploy-env.ps1")
$null = Import-CtrackDeployEnv

if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
  $ProjectRef = $env:SUPABASE_PROJECT_REF
}

function Get-SupabaseCliAccessToken {
  $candidates = @(
    (Join-Path $env:USERPROFILE ".supabase\access-token"),
    (Join-Path $env:APPDATA "supabase\access-token"),
    (Join-Path $env:LOCALAPPDATA "supabase\access-token")
  )
  foreach ($path in $candidates) {
    if (Test-Path -LiteralPath $path) {
      $token = (Get-Content -LiteralPath $path -Raw).Trim()
      if (-not [string]::IsNullOrWhiteSpace($token)) {
        return $token
      }
    }
  }
  return $null
}

function Resolve-AccessToken {
  if (-not [string]::IsNullOrWhiteSpace($env:SUPABASE_ACCESS_TOKEN)) {
    return $env:SUPABASE_ACCESS_TOKEN.Trim()
  }

  $cached = Get-SupabaseCliAccessToken
  if (-not [string]::IsNullOrWhiteSpace($cached)) {
    $env:SUPABASE_ACCESS_TOKEN = $cached
    return $cached
  }

  if ($Login) {
    Write-Host "`[deploy-edge`] No SUPABASE_ACCESS_TOKEN in .env - running supabase login..."
    npx --yes supabase@latest login
    if ($LASTEXITCODE -ne 0) {
      throw "supabase login failed (exit $LASTEXITCODE)"
    }
    $cached = Get-SupabaseCliAccessToken
    if ([string]::IsNullOrWhiteSpace($cached)) {
      throw "supabase login succeeded but access token file was not found."
    }
    $env:SUPABASE_ACCESS_TOKEN = $cached
    return $cached
  }

  return $null
}

$accessToken = Resolve-AccessToken
if ([string]::IsNullOrWhiteSpace($accessToken)) {
  throw "Missing SUPABASE_ACCESS_TOKEN in ctrack_publish_web/.env. Get one at https://supabase.com/dashboard/account/tokens then run: npm run deploy:edge"
}

$workdir = (Resolve-Path -LiteralPath $SupabaseWorkdir).Path
$supabaseDir = Join-Path $workdir "supabase"
if (-not (Test-Path -LiteralPath $supabaseDir)) {
  throw "Supabase folder not found: $supabaseDir"
}

Write-Host "`[deploy-edge`] Project ref: $ProjectRef"
Write-Host "`[deploy-edge`] Workdir: $workdir"
Write-Host "`[deploy-edge`] Functions: $($Function -join ', ')"

foreach ($name in $Function) {
  $entry = Join-Path $supabaseDir "functions\$name\index.ts"
  if (-not (Test-Path -LiteralPath $entry)) {
    throw "Function entry not found: $entry"
  }

  Write-Host "`[deploy-edge`] Deploying $name ..."
  Push-Location $workdir
  try {
    $deployArgs = @(
      "functions", "deploy", $name,
      "--project-ref", $ProjectRef,
      "--no-verify-jwt",
      "--use-api"
    )
    npx --yes supabase@latest @deployArgs
    if ($LASTEXITCODE -ne 0) {
      throw "supabase functions deploy failed for $name (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }
  Write-Host "`[deploy-edge`] OK: $name"
}

Write-Host "`[deploy-edge`] All functions deployed."
Write-Host "`[deploy-edge`] URLs:"
foreach ($name in $Function) {
  Write-Host ("  https://{0}.supabase.co/functions/v1/{1}" -f $ProjectRef, $name)
}
