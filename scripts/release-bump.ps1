param(
  [ValidateSet("patch", "minor", "major")]
  [string]$Bump = "patch",
  [string[]]$Targets = @("engine", "nuke", "web"),
  [string]$VersionFile = (Join-Path $PSScriptRoot "..\version.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-VersionKey {
  param([Parameter(Mandatory = $true)][string]$Target)

  $normalizedTarget = $Target.Trim().ToLowerInvariant()
  switch ($normalizedTarget) {
    "engine" { return "engine" }
    "nuke" { return "nukePlugin" }
    "nukeplugin" { return "nukePlugin" }
    "web" { return "web" }
    default { throw "Unsupported target '$Target'. Allowed: engine, nuke, web." }
  }
}

function Invoke-SemverBump {
  param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$BumpType
  )

  if ($Version -notmatch "^(\d+)\.(\d+)\.(\d+)$") {
    throw "Version '$Version' is not a valid semver value (X.Y.Z)."
  }

  $major = [int]$matches[1]
  $minor = [int]$matches[2]
  $patch = [int]$matches[3]

  switch ($BumpType) {
    "major" {
      $major++
      $minor = 0
      $patch = 0
    }
    "minor" {
      $minor++
      $patch = 0
    }
    "patch" {
      $patch++
    }
    default {
      throw "Unsupported bump type '$BumpType'."
    }
  }

  return "$major.$minor.$patch"
}

if (-not (Test-Path -LiteralPath $VersionFile)) {
  throw "Version file not found: $VersionFile"
}

$versionData = Get-Content -LiteralPath $VersionFile -Raw | ConvertFrom-Json
$versionMap = [ordered]@{
  engine = [string]$versionData.engine
  nukePlugin = [string]$versionData.nukePlugin
  web = [string]$versionData.web
}

$resolvedKeys = New-Object System.Collections.Generic.List[string]
foreach ($target in $Targets) {
  $resolvedKey = Resolve-VersionKey -Target $target
  if (-not $resolvedKeys.Contains($resolvedKey)) {
    $resolvedKeys.Add($resolvedKey)
  }
}

if ($resolvedKeys.Count -eq 0) {
  throw "No valid targets were provided."
}

foreach ($key in $resolvedKeys) {
  $currentVersion = [string]$versionMap[$key]
  $nextVersion = Invoke-SemverBump -Version $currentVersion -BumpType $Bump
  $versionMap[$key] = $nextVersion
  Write-Host "[release-bump] ${key}: $currentVersion -> $nextVersion"
}

$jsonBody = $versionMap | ConvertTo-Json
Set-Content -LiteralPath $VersionFile -Value ($jsonBody + [Environment]::NewLine) -Encoding UTF8

Write-Host "[release-bump] Updated $VersionFile"
