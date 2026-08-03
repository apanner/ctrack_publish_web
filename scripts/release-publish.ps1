<#
Publish CTrack installers to GitHub Releases + upsert Supabase engine_releases.

Required environment variables:
  - SUPABASE_URL
  - SUPABASE_SERVICE_ROLE_KEY
  - GITHUB_TOKEN (or GH_TOKEN) — fine-grained PAT or Actions GITHUB_TOKEN

Optional:
  - GITHUB_REPOSITORY (owner/repo — auto-detected via gh when unset)
  - GITHUB_SHA
  - SkipBuild switch (artifacts must already exist under installer/output)

Usage:
  powershell -File scripts/release-publish.ps1
  powershell -File scripts/release-publish.ps1 -SkipBuild -Channel beta -ReleaseNotes "Fix pairing"
#>

param(
  [switch]$SkipBuild,
  [string]$Channel = "stable",
  [string]$VersionFile = (Join-Path $PSScriptRoot "..\version.json"),
  [string]$ReleaseNotes = "",
  [switch]$Breaking
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

function Assert-EnvironmentValue {
  param([Parameter(Mandatory = $true)][string]$Name)

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable: $Name"
  }

  return $value
}

function Resolve-GithubToken {
  $token = [Environment]::GetEnvironmentVariable("GITHUB_TOKEN")
  if ([string]::IsNullOrWhiteSpace($token)) {
    $token = [Environment]::GetEnvironmentVariable("GH_TOKEN")
  }
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw "Missing GITHUB_TOKEN (or GH_TOKEN). In GitHub Actions this is automatic; locally use a PAT with contents:write."
  }
  [Environment]::SetEnvironmentVariable("GH_TOKEN", $token, "Process")
  return $token
}

function Resolve-GithubRepository {
  $repo = [Environment]::GetEnvironmentVariable("GITHUB_REPOSITORY")
  if (-not [string]::IsNullOrWhiteSpace($repo)) {
    return $repo.Trim()
  }

  $ghRepo = gh repo view --json nameWithOwner -q .nameWithOwner 2>$null
  if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($ghRepo)) {
    return $ghRepo.Trim()
  }

  throw "Could not resolve GitHub repository. Set GITHUB_REPOSITORY=owner/repo or run from a git repo with gh authenticated."
}

function Get-ArtifactMetadata {
  param([Parameter(Mandatory = $true)][string]$FilePath)

  if (-not (Test-Path -LiteralPath $FilePath)) {
    throw "Artifact not found: $FilePath"
  }

  $item = Get-Item -LiteralPath $FilePath
  $hash = (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()

  return [ordered]@{
    fileName = $item.Name
    fullPath = $item.FullName
    sha256 = $hash
    sizeBytes = [int64]$item.Length
  }
}

function Write-Sha256Sidecar {
  param(
    [Parameter(Mandatory = $true)][string]$ArtifactPath,
    [Parameter(Mandatory = $true)][string]$Sha256
  )

  $artifactItem = Get-Item -LiteralPath $ArtifactPath
  $outputPath = "$ArtifactPath.sha256"
  $line = "$Sha256 *$($artifactItem.Name)"
  Set-Content -LiteralPath $outputPath -Value ($line + [Environment]::NewLine) -Encoding ASCII
  return $outputPath
}

Assert-CommandAvailable -CommandName "gh"
Resolve-GithubToken | Out-Null
$githubRepo = Resolve-GithubRepository

$supabaseUrl = Assert-EnvironmentValue -Name "SUPABASE_URL"
$serviceRoleKey = Assert-EnvironmentValue -Name "SUPABASE_SERVICE_ROLE_KEY"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nukeRoot = Join-Path $repoRoot "ctrack_nuke"
if (-not (Test-Path -LiteralPath $nukeRoot)) {
  $legacyNuke = Join-Path $repoRoot "..\ctrack_nuke"
  if (Test-Path -LiteralPath $legacyNuke) {
    $nukeRoot = (Resolve-Path -LiteralPath $legacyNuke).Path
  } else {
    throw "Nuke installer sources not found. Expected ctrack_nuke/ in the repo root."
  }
}

Write-Host "`[release-publish`] Syncing version.json into build artifacts..."
& (Join-Path $repoRoot "scripts\sync-version.ps1")
if (-not $?) {
  throw "sync-version.ps1 failed."
}

if (-not (Test-Path -LiteralPath $VersionFile)) {
  throw "Version file not found: $VersionFile"
}

$versionData = Get-Content -LiteralPath $VersionFile -Raw | ConvertFrom-Json
$releaseVersion = [string]$versionData.engine
if ($releaseVersion -notmatch "^\d+\.\d+\.\d+$") {
  throw "version.json engine value must be semver (X.Y.Z). Got: '$releaseVersion'"
}

if (-not $SkipBuild) {
  Write-Host "`[release-publish`] Building engine installer..."
  & (Join-Path $repoRoot "scripts\build-installer.bat")
  if ($LASTEXITCODE -ne 0) {
    throw "Engine installer build failed."
  }

  Write-Host "`[release-publish`] Building Nuke installer..."
  & (Join-Path $nukeRoot "installer\build-installer.bat")
  if ($LASTEXITCODE -ne 0) {
    throw "Nuke installer build failed."
  }
}

$engineSetupPath = Join-Path $repoRoot "installer\output\CTrackPublishEngine-Setup.exe"
$nukeSetupPath = Join-Path $nukeRoot "installer\output\CTrackNuke-Setup.exe"

$engineArtifact = Get-ArtifactMetadata -FilePath $engineSetupPath
$nukeArtifact = Get-ArtifactMetadata -FilePath $nukeSetupPath

$engineShaPath = Write-Sha256Sidecar -ArtifactPath $engineArtifact.fullPath -Sha256 $engineArtifact.sha256
$nukeShaPath = Write-Sha256Sidecar -ArtifactPath $nukeArtifact.fullPath -Sha256 $nukeArtifact.sha256

$generatedDir = Join-Path $repoRoot ".release"
if (-not (Test-Path -LiteralPath $generatedDir)) {
  New-Item -ItemType Directory -Path $generatedDir -Force | Out-Null
}

$latestJsonPath = Join-Path $generatedDir "latest.json"
$releaseManifestPath = Join-Path $generatedDir "manifest.json"
& (Join-Path $repoRoot "scripts\write-latest-json.ps1") `
  -Version $releaseVersion `
  -Channel $Channel `
  -EngineSetupPath $engineArtifact.fullPath `
  -NukeSetupPath $nukeArtifact.fullPath `
  -OutputPath $latestJsonPath `
  -ReleaseNotes $ReleaseNotes `
  -Breaking:$Breaking
if (-not $?) {
  throw "write-latest-json.ps1 failed."
}
Copy-Item -LiteralPath $latestJsonPath -Destination $releaseManifestPath -Force

$releaseTag = "v$releaseVersion"
$releaseTitle = "CTrack Engine $releaseVersion"
$releaseBody = if ([string]::IsNullOrWhiteSpace($ReleaseNotes)) {
  "Windows installers for CTrack Publish Engine and CTrack Nuke plugin."
} else {
  $ReleaseNotes
}

$gitSha = if ([string]::IsNullOrWhiteSpace($env:GITHUB_SHA)) {
  (git -C $repoRoot rev-parse HEAD).Trim()
} else {
  $env:GITHUB_SHA
}

Write-Host "`[release-publish`] Publishing GitHub Release $releaseTag on $githubRepo ..."

$releaseExists = $false
$priorErrorPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
gh release view $releaseTag --repo $githubRepo 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  $releaseExists = $true
}
$ErrorActionPreference = $priorErrorPreference

if (-not $releaseExists) {
  gh release create $releaseTag `
    --repo $githubRepo `
    --title $releaseTitle `
    --notes $releaseBody `
    --target $gitSha
  if ($LASTEXITCODE -ne 0) {
    throw "gh release create failed for tag $releaseTag"
  }
} else {
  Write-Host "`[release-publish`] Release $releaseTag already exists - uploading/replacing assets."
}

$uploadPaths = @(
  $engineArtifact.fullPath,
  $engineShaPath,
  $nukeArtifact.fullPath,
  $nukeShaPath,
  $latestJsonPath,
  $releaseManifestPath
)

gh release upload $releaseTag $uploadPaths --repo $githubRepo --clobber
if ($LASTEXITCODE -ne 0) {
  throw "gh release upload failed for tag $releaseTag"
}

$storagePrefix = "github:$githubRepo"

$supabaseInsertBody = @(
  [ordered]@{
    version = $releaseVersion
    channel = $Channel
    s3_prefix = $storagePrefix
    engine_s3_key = $engineArtifact.fileName
    engine_sha256 = $engineArtifact.sha256
    engine_size_bytes = $engineArtifact.sizeBytes
    nuke_s3_key = $nukeArtifact.fileName
    nuke_sha256 = $nukeArtifact.sha256
    nuke_size_bytes = $nukeArtifact.sizeBytes
    release_notes = $ReleaseNotes
    breaking = [bool]$Breaking
    git_sha = $gitSha
    created_by = "github-actions"
  }
) | ConvertTo-Json -Depth 5

$supabaseHeaders = @{
  apikey = $serviceRoleKey
  Authorization = "Bearer $serviceRoleKey"
  "Content-Type" = "application/json"
  Prefer = "resolution=merge-duplicates,return=representation"
}

$supabaseUri = $supabaseUrl.TrimEnd("/") + "/rest/v1/engine_releases?on_conflict=version"
$response = Invoke-RestMethod -Method Post -Uri $supabaseUri -Headers $supabaseHeaders -Body $supabaseInsertBody

Write-Host "`[release-publish`] Published version $releaseVersion to GitHub Release $releaseTag"
Write-Host "`[release-publish`] Repository: https://github.com/$githubRepo/releases/tag/$releaseTag"
Write-Host "`[release-publish`] Upserted engine_releases row count: $($response.Count)"
