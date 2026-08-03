#Requires -Version 5.1
<#
  Authenticode-sign Windows executables with signtool (optional).

  Environment variables:
    CTRACK_CODESIGN_PFX          Path to .pfx certificate (local dev)
    CTRACK_CODESIGN_PFX_BASE64   Base64-encoded .pfx (CI — written to temp file)
    CTRACK_CODESIGN_PASSWORD     Certificate password
    CTRACK_CODESIGN_TIMESTAMP_URL  Optional RFC3161 timestamp server (default: DigiCert)

  Usage:
    powershell -File scripts/sign-windows-binary.ps1 -Path installer\output\CTrackPublishEngine-Setup.exe
    powershell -File scripts/sign-windows-binary.ps1 -Path release\runtime\node.exe,release\engine\runtime\python\python.exe
#>

param(
  [Parameter(Mandatory = $true)]
  [string[]]$Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-SignToolPath {
  $kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
  if (Test-Path $kits) {
    $candidates = Get-ChildItem -Path $kits -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } |
      Where-Object { Test-Path $_ }
    if ($candidates) {
      return $candidates[0]
    }
  }

  $fallback = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($fallback) {
    return $fallback.Source
  }

  throw "signtool.exe not found. Install Windows SDK or Visual Studio Build Tools."
}

function Resolve-PfxPath {
  $pfxPath = [Environment]::GetEnvironmentVariable("CTRACK_CODESIGN_PFX")
  if (-not [string]::IsNullOrWhiteSpace($pfxPath) -and (Test-Path $pfxPath)) {
    return (Resolve-Path $pfxPath).Path
  }

  $pfxBase64 = [Environment]::GetEnvironmentVariable("CTRACK_CODESIGN_PFX_BASE64")
  if ([string]::IsNullOrWhiteSpace($pfxBase64)) {
    return $null
  }

  $tempPfx = Join-Path $env:TEMP ("ctrack-codesign-{0}.pfx" -f [guid]::NewGuid().ToString("N"))
  [IO.File]::WriteAllBytes($tempPfx, [Convert]::FromBase64String($pfxBase64.Trim()))
  return $tempPfx
}

function Test-CodeSigningConfigured {
  $password = [Environment]::GetEnvironmentVariable("CTRACK_CODESIGN_PASSWORD")
  if ([string]::IsNullOrWhiteSpace($password)) {
    return $false
  }
  return $null -ne (Resolve-PfxPath)
}

if (-not (Test-CodeSigningConfigured)) {
  Write-Host "[codesign] Skipping — set CTRACK_CODESIGN_PFX (or _BASE64) and CTRACK_CODESIGN_PASSWORD to enable signing."
  exit 0
}

$signTool = Resolve-SignToolPath
$pfxPath = Resolve-PfxPath
$password = [Environment]::GetEnvironmentVariable("CTRACK_CODESIGN_PASSWORD")
$timestampUrl = [Environment]::GetEnvironmentVariable("CTRACK_CODESIGN_TIMESTAMP_URL")
if ([string]::IsNullOrWhiteSpace($timestampUrl)) {
  $timestampUrl = "http://timestamp.digicert.com"
}

$signed = 0
foreach ($target in $Path) {
  if ([string]::IsNullOrWhiteSpace($target)) { continue }
  $resolved = Resolve-Path -LiteralPath $target -ErrorAction SilentlyContinue
  if (-not $resolved) {
    Write-Warning "[codesign] File not found, skipping: $target"
    continue
  }

  Write-Host "[codesign] Signing $($resolved.Path) ..."
  & $signTool sign `
    /f $pfxPath `
    /p $password `
    /tr $timestampUrl `
    /td sha256 `
    /fd sha256 `
    /as `
    $resolved.Path
  if ($LASTEXITCODE -ne 0) {
    throw "signtool failed for $($resolved.Path) (exit $LASTEXITCODE)"
  }
  $signed++
}

if ($signed -eq 0) {
  throw "[codesign] No files were signed."
}

Write-Host "[codesign] Signed $signed file(s)."
