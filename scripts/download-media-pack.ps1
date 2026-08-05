# Downloads FFmpeg + OpenImageIO + OCIO into engine/runtime (media pack).
# Used by lazy install: POST /api/runtime/ensure or first transcode.

param(
  [Parameter(Mandatory = $false)]
  [string]$TargetRoot = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if ($TargetRoot) {
  $engineRoot = Resolve-Path $TargetRoot
} else {
  $engineRoot = Join-Path $repoRoot "engine"
}

& (Join-Path $PSScriptRoot "ensure-engine-runtime.ps1") -TargetRoot $engineRoot -Provision @PSBoundParameters

Write-Host "[ctrack] Media pack ready under $engineRoot\runtime"
