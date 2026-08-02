<#
Loads deploy credentials from ctrack_publish_web/.env (primary).

Also merges missing keys from (gitignored):
  - ../ctrack_v0/.env.local
  - .env.deploy (optional override)

Normalizes aliases used across the monorepo:
  VITE_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL → SUPABASE_URL
  AWS_S3_BUCKET_NAME → AWS_S3_BUCKET
  VITE_SUPABASE_ANON_KEY → available for verify scripts

Usage (dot-source):
  . "$PSScriptRoot\load-deploy-env.ps1"
  Import-CtrackDeployEnv | Out-Null
#>

function Import-CtrackDotEnvFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  Write-Host "[env] Loading $(Split-Path $Path -Leaf) from $Path"
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) {
      return
    }
    $eq = $line.IndexOf("=")
    if ($eq -lt 1) {
      return
    }
    $key = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($key, $value, "Process")
  }
}

function Set-EnvIfEmpty {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [AllowNull()][string]$Value
  )
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return
  }
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name))) {
    [Environment]::SetEnvironmentVariable($Name, $Value.Trim(), "Process")
  }
}

function Import-CtrackDeployEnv {
  param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  )

  $envFiles = @(
    (Join-Path $RepoRoot ".env"),
    (Join-Path $RepoRoot "engine\.env"),
    (Join-Path $RepoRoot "..\ctrack_v0\.env.local"),
    (Join-Path $RepoRoot ".env.deploy")
  )

  foreach ($file in $envFiles) {
    Import-CtrackDotEnvFile -Path $file
  }

  Set-EnvIfEmpty -Name "SUPABASE_URL" -Value $env:VITE_SUPABASE_URL
  Set-EnvIfEmpty -Name "SUPABASE_URL" -Value $env:NEXT_PUBLIC_SUPABASE_URL
  Set-EnvIfEmpty -Name "SUPABASE_SERVICE_ROLE_KEY" -Value $env:NEXT_SUPABASE_SERVICE_ROLE_KEY
  Set-EnvIfEmpty -Name "SUPABASE_SERVICE_ROLE_KEY" -Value $env:VITE_SUPABASE_SERVICE_ROLE_KEY
  Set-EnvIfEmpty -Name "AWS_S3_BUCKET" -Value $env:AWS_S3_BUCKET_NAME
  Set-EnvIfEmpty -Name "AWS_DEFAULT_REGION" -Value $env:AWS_REGION
  Set-EnvIfEmpty -Name "VITE_SUPABASE_ANON_KEY" -Value $env:NEXT_PUBLIC_SUPABASE_ANON_KEY

  if ([string]::IsNullOrWhiteSpace($env:SUPABASE_PROJECT_REF) -and -not [string]::IsNullOrWhiteSpace($env:SUPABASE_URL)) {
    try {
      $hostName = ([Uri]$env:SUPABASE_URL).Host
      $ref = $hostName.Split(".")[0]
      if (-not [string]::IsNullOrWhiteSpace($ref)) {
        [Environment]::SetEnvironmentVariable("SUPABASE_PROJECT_REF", $ref, "Process")
      }
    } catch {
      # ignore parse errors
    }
  }

  if ([string]::IsNullOrWhiteSpace($env:SUPABASE_PROJECT_REF)) {
    [Environment]::SetEnvironmentVariable("SUPABASE_PROJECT_REF", "czwfeqheduofviockrab", "Process")
  }

  return [ordered]@{
    RepoRoot = $RepoRoot
    SupabaseUrl = $env:SUPABASE_URL
    ProjectRef = $env:SUPABASE_PROJECT_REF
    HasAccessToken = -not [string]::IsNullOrWhiteSpace($env:SUPABASE_ACCESS_TOKEN)
    HasServiceRole = -not [string]::IsNullOrWhiteSpace($env:SUPABASE_SERVICE_ROLE_KEY)
    HasGithubToken = -not [string]::IsNullOrWhiteSpace($env:GITHUB_RELEASE_TOKEN) -or -not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)
    HasAwsBucket = -not [string]::IsNullOrWhiteSpace($env:AWS_S3_BUCKET)
  }
}
