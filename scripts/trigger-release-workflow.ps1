<#
Trigger the CTrack Deploy (release) GitHub Actions workflow without a local build.

Requires: GitHub CLI (`gh`) authenticated (`gh auth login`).

Usage:
  powershell -File scripts/trigger-release-workflow.ps1
  powershell -File scripts/trigger-release-workflow.ps1 -Channel beta -ReleaseNotes "Test release"
  powershell -File scripts/trigger-release-workflow.ps1 -SkipEdge
#>

param(
  [string]$Channel = "stable",
  [string]$ReleaseNotes = "",
  [switch]$SkipBuild,
  [switch]$SkipEdge,
  [string]$Ref = "main"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($null -eq $gh) {
  throw "GitHub CLI (gh) not found. Install from https://cli.github.com/"
}

$workflowFile = "ctrack-deploy.yml"
$gitRoot = (git -C $PSScriptRoot rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gitRoot)) {
  $gitRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
$repoRoot = $gitRoot

Push-Location $repoRoot
try {
  $args = @("workflow", "run", $workflowFile, "--ref", $Ref)
  $args += "-f"
  $args += "channel=$Channel"
  if (-not [string]::IsNullOrWhiteSpace($ReleaseNotes)) {
    $args += "-f"
    $args += "release_notes=$ReleaseNotes"
  }
  if ($SkipBuild) {
    $args += "-f"
    $args += "skip_build=true"
  }
  if ($SkipEdge) {
    $args += "-f"
    $args += "skip_edge=true"
  }

  Write-Host "[trigger-release] Repo: $(gh repo view --json nameWithOwner -q .nameWithOwner)"
  Write-Host "[trigger-release] Workflow: $workflowFile on ref $Ref"

  & gh @args
  if ($LASTEXITCODE -ne 0) {
    throw "gh workflow run failed (exit $LASTEXITCODE)"
  }

  Write-Host "[trigger-release] Workflow dispatched. Watch:"
  gh run list --workflow $workflowFile --limit 1
  Write-Host "[trigger-release] Or open: https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/actions"
} finally {
  Pop-Location
}
