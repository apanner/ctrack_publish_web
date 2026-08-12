<#
.SYNOPSIS
  Pre-allow Chrome/Edge to reach local CTrack Engine from the hosted web app (no permission prompt).

.DESCRIPTION
  Chrome/Edge show "Allow local network access?" when https://ctrackpublishweb.vercel.app
  calls http://127.0.0.1:7777. This script writes enterprise policy allowlists so that
  prompt is skipped for CTrack.

  Prefer signing in via http://127.0.0.1:7777/auth/link (tray Sign in) — that path never
  needs this permission. Use this script when you publish from the Vercel UI and Chrome
  still asks for local network access.

  Requires Administrator (HKLM Policies).

.EXAMPLE
  # Right-click → Run with PowerShell as Administrator, or:
  powershell -ExecutionPolicy Bypass -File scripts\allow-chrome-local-network.ps1
#>

[CmdletBinding()]
param(
  [string[]]$Origins = @(
    "https://ctrackpublishweb.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ),
  [switch]$CurrentUserOnly
)

$ErrorActionPreference = "Stop"

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-PolicyList {
  param(
    [Parameter(Mandatory = $true)][string]$HiveRoot,
    [Parameter(Mandatory = $true)][string[]]$Urls
  )
  $policyPath = Join-Path $HiveRoot "LocalNetworkAccessAllowedForUrls"
  if (-not (Test-Path $policyPath)) {
    New-Item -Path $policyPath -Force | Out-Null
  }
  # Clear previous numbered entries so the list matches exactly.
  Get-Item -Path $policyPath |
    Select-Object -ExpandProperty Property |
    Where-Object { $_ -match '^\d+$' } |
    ForEach-Object { Remove-ItemProperty -Path $policyPath -Name $_ -ErrorAction SilentlyContinue }

  $i = 1
  foreach ($url in $Urls) {
    $trimmed = $url.Trim().TrimEnd("/")
    if (-not $trimmed) { continue }
    New-ItemProperty -Path $policyPath -Name "$i" -Value $trimmed -PropertyType String -Force | Out-Null
    $i++
  }
  Write-Host "  Wrote $policyPath ($($i - 1) origin(s))"
}

if (-not $CurrentUserOnly -and -not (Test-IsAdmin)) {
  Write-Host "Elevating to Administrator..."
  $argList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSCommandPath`""
  )
  foreach ($o in $Origins) {
    $argList += @("-Origins", $o)
  }
  Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList -Wait
  exit $LASTEXITCODE
}

$hives = @()
if ($CurrentUserOnly) {
  $hives += "HKCU:\SOFTWARE\Policies\Google\Chrome"
  $hives += "HKCU:\SOFTWARE\Policies\Microsoft\Edge"
} else {
  $hives += "HKLM:\SOFTWARE\Policies\Google\Chrome"
  $hives += "HKLM:\SOFTWARE\Policies\Microsoft\Edge"
}

Write-Host "Allowing local-network access for:"
$Origins | ForEach-Object { Write-Host "  - $_" }
Write-Host ""

foreach ($hive in $hives) {
  if (-not (Test-Path $hive)) {
    New-Item -Path $hive -Force | Out-Null
  }
  Write-PolicyList -HiveRoot $hive -Urls $Origins
}

Write-Host ""
Write-Host "Done. Restart Chrome/Edge completely (chrome://restart / edge://restart), then open CTrack."
Write-Host "Verify: chrome://policy → LocalNetworkAccessAllowedForUrls"
Write-Host ""
Write-Host "Tip: Tray → Sign in opens http://127.0.0.1:7777/auth/link (no prompt needed)."
