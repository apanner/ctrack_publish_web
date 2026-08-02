param(
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [string]$Channel = "stable",
  [Parameter(Mandatory = $true)]
  [string]$EngineSetupPath,
  [Parameter(Mandatory = $true)]
  [string]$NukeSetupPath,
  [string]$OutputPath = (Join-Path $PSScriptRoot "..\public\latest.json"),
  [string]$ReleaseNotes = "",
  [switch]$Breaking
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-ArtifactMetadata {
  param([Parameter(Mandatory = $true)][string]$FilePath)

  if (-not (Test-Path -LiteralPath $FilePath)) {
    throw "Artifact not found: $FilePath"
  }

  $item = Get-Item -LiteralPath $FilePath
  $hash = Get-FileHash -LiteralPath $FilePath -Algorithm SHA256

  return [ordered]@{
    fileName = $item.Name
    sha256 = $hash.Hash.ToLowerInvariant()
    sizeBytes = [int64]$item.Length
  }
}

$outputDirectory = Split-Path -Path $OutputPath -Parent
if ([string]::IsNullOrWhiteSpace($outputDirectory) -eq $false -and -not (Test-Path -LiteralPath $outputDirectory)) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}

$engineArtifact = Get-ArtifactMetadata -FilePath $EngineSetupPath
$nukeArtifact = Get-ArtifactMetadata -FilePath $NukeSetupPath

$latestPayload = [ordered]@{
  product = "ctrack-engine"
  channel = $Channel
  version = $Version
  publishedAt = [DateTime]::UtcNow.ToString("o")
  artifacts = [ordered]@{
    engineSetup = $engineArtifact
    nukeSetup = $nukeArtifact
    nukePluginSetup = $nukeArtifact
  }
  releaseNotes = $ReleaseNotes
  breaking = [bool]$Breaking
}

$jsonBody = $latestPayload | ConvertTo-Json -Depth 8
Set-Content -LiteralPath $OutputPath -Value ($jsonBody + [Environment]::NewLine) -Encoding UTF8

Write-Host "[write-latest-json] Wrote $OutputPath"
