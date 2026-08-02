<#
Smoke-test deployed Edge Functions.
Loads ctrack_publish_web/.env automatically.
#>

param(
  [string]$ProjectRef,
  [string]$AnonKey
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "load-deploy-env.ps1")
Import-CtrackDeployEnv | Out-Null

if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
  $ProjectRef = $env:SUPABASE_PROJECT_REF
}
if ([string]::IsNullOrWhiteSpace($AnonKey)) {
  $AnonKey = $env:VITE_SUPABASE_ANON_KEY
}

if ([string]::IsNullOrWhiteSpace($AnonKey)) {
  throw "Missing VITE_SUPABASE_ANON_KEY in ctrack_publish_web/.env"
}

$base = "https://$ProjectRef.supabase.co/functions/v1"
$headers = @{
  apikey = $AnonKey
  Authorization = "Bearer $AnonKey"
}

Write-Host "[verify] GET engine-releases-latest ..."
$uri = "$base/engine-releases-latest?channel=stable"
try {
  $response = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
  Write-Host "[verify] OK - latest release version: $($response.version)"
} catch {
  Write-Host "[verify] FAIL - $($_.Exception.Message)"
  if ($_.ErrorDetails.Message) {
    Write-Host $_.ErrorDetails.Message
  }
  exit 1
}

Write-Host "[verify] OPTIONS engine-pair-init (CORS) ..."
try {
  $null = Invoke-WebRequest -Method Options -Uri "$base/engine-pair-init" -Headers $headers -UseBasicParsing
  Write-Host "[verify] OK - pair-init reachable"
} catch {
  Write-Host "[verify] WARN - pair-init OPTIONS: $($_.Exception.Message)"
}

Write-Host "[verify] Done."
