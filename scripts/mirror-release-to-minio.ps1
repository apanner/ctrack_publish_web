<#
# Deprecated: installer releases now use GitHub Releases (see scripts/release-publish.ps1).
# This script only backfills MinIO for legacy S3-hosted releases.

Uses the same object keys under HYBRID_STORAGE_PRIMARY_BUCKET as AWS S3.
Requires: aws CLI, AWS credentials for source bucket, HYBRID_STORAGE_PRIMARY_* for MinIO.

Usage:
  powershell -File scripts/mirror-release-to-minio.ps1 -Version 0.1.2
  powershell -File scripts/mirror-release-to-minio.ps1 -Version 0.1.2 -Channel stable
#>

param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Channel = "stable"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "load-deploy-env.ps1")
Import-CtrackDeployEnv | Out-Null

function Assert-CommandAvailable {
  param([Parameter(Mandatory = $true)][string]$CommandName)

  $command = Get-Command -Name $CommandName -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    throw "Required command not found in PATH: $CommandName"
  }
}

function Get-MinioMirrorConfig {
  $endpoint = [Environment]::GetEnvironmentVariable("HYBRID_STORAGE_PRIMARY_ENDPOINT")
  $bucket = [Environment]::GetEnvironmentVariable("HYBRID_STORAGE_PRIMARY_BUCKET")
  $accessKey = [Environment]::GetEnvironmentVariable("HYBRID_STORAGE_PRIMARY_ACCESS_KEY")
  $secretKey = [Environment]::GetEnvironmentVariable("HYBRID_STORAGE_PRIMARY_SECRET_KEY")
  $region = [Environment]::GetEnvironmentVariable("HYBRID_STORAGE_PRIMARY_REGION")
  if ([string]::IsNullOrWhiteSpace($region)) {
    $region = "us-east-1"
  }

  if (
    [string]::IsNullOrWhiteSpace($endpoint) -or
    [string]::IsNullOrWhiteSpace($bucket) -or
    [string]::IsNullOrWhiteSpace($accessKey) -or
    [string]::IsNullOrWhiteSpace($secretKey)
  ) {
    throw "Missing HYBRID_STORAGE_PRIMARY_* env (check .env or engine/.env)"
  }

  return [ordered]@{
    Endpoint = $endpoint.Trim()
    Bucket = $bucket.Trim()
    AccessKey = $accessKey.Trim()
    SecretKey = $secretKey.Trim()
    Region = $region.Trim()
  }
}

Assert-CommandAvailable -CommandName "aws"

$awsBucket = [Environment]::GetEnvironmentVariable("AWS_S3_BUCKET")
if ([string]::IsNullOrWhiteSpace($awsBucket)) {
  throw "Missing AWS_S3_BUCKET"
}

$minioConfig = Get-MinioMirrorConfig
$releasePrefix = "ctrack-downloads/releases/$Version"
$channelLatestKey = "ctrack-downloads/channels/$Channel/latest.json"
$tempDir = Join-Path $env:TEMP ("ctrack-release-mirror-{0}" -f [Guid]::NewGuid().ToString("N"))

try {
  New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

  Write-Host "[mirror-minio] Downloading s3://$awsBucket/$releasePrefix/ ..."
  & aws s3 sync "s3://$awsBucket/$releasePrefix/" $tempDir --only-show-errors
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to download release prefix from AWS S3"
  }

  $savedAccessKey = [Environment]::GetEnvironmentVariable("AWS_ACCESS_KEY_ID")
  $savedSecretKey = [Environment]::GetEnvironmentVariable("AWS_SECRET_ACCESS_KEY")
  $savedRegion = [Environment]::GetEnvironmentVariable("AWS_DEFAULT_REGION")

  try {
    [Environment]::SetEnvironmentVariable("AWS_ACCESS_KEY_ID", $minioConfig.AccessKey, "Process")
    [Environment]::SetEnvironmentVariable("AWS_SECRET_ACCESS_KEY", $minioConfig.SecretKey, "Process")
    [Environment]::SetEnvironmentVariable("AWS_DEFAULT_REGION", $minioConfig.Region, "Process")

    Write-Host "[mirror-minio] Uploading to MinIO s3://$($minioConfig.Bucket)/$releasePrefix/ ..."
    & aws s3 sync $tempDir "s3://$($minioConfig.Bucket)/$releasePrefix/" `
      --endpoint-url $minioConfig.Endpoint `
      --only-show-errors
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to upload release prefix to MinIO"
    }

    $latestJson = Join-Path $tempDir "latest.json"
    if (Test-Path -LiteralPath $latestJson) {
      Write-Host "[mirror-minio] Updating channel pointer on MinIO: $channelLatestKey"
      & aws s3 cp $latestJson "s3://$($minioConfig.Bucket)/$channelLatestKey" `
        --endpoint-url $minioConfig.Endpoint `
        --content-type "application/json" `
        --only-show-errors
      if ($LASTEXITCODE -ne 0) {
        throw "Failed to upload channel latest.json to MinIO"
      }
    }
  } finally {
    if ($null -ne $savedAccessKey) {
      [Environment]::SetEnvironmentVariable("AWS_ACCESS_KEY_ID", $savedAccessKey, "Process")
    } else {
      [Environment]::SetEnvironmentVariable("AWS_ACCESS_KEY_ID", $null, "Process")
    }
    if ($null -ne $savedSecretKey) {
      [Environment]::SetEnvironmentVariable("AWS_SECRET_ACCESS_KEY", $savedSecretKey, "Process")
    } else {
      [Environment]::SetEnvironmentVariable("AWS_SECRET_ACCESS_KEY", $null, "Process")
    }
    if ($null -ne $savedRegion) {
      [Environment]::SetEnvironmentVariable("AWS_DEFAULT_REGION", $savedRegion, "Process")
    } else {
      [Environment]::SetEnvironmentVariable("AWS_DEFAULT_REGION", $null, "Process")
    }
  }

  Write-Host "[mirror-minio] Done. MinIO backup: s3://$($minioConfig.Bucket)/$releasePrefix/"
} finally {
  if (Test-Path -LiteralPath $tempDir) {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
