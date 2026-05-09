#Requires -Version 5.1
<#
  Downloads portable Node.js (Windows x64) into release\runtime\node.exe
  so end users do not need Node installed. Run after scripts\build-release.bat.

  Usage (from repo root):
    powershell -ExecutionPolicy Bypass -File scripts\embed-node.ps1
    powershell -File scripts\embed-node.ps1 -Version 22.14.0
#>
param(
    [string] $Version = "22.14.0"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$releaseRoot = Join-Path $repoRoot "release"
$runtimeDir = Join-Path $releaseRoot "runtime"
$zipName = "node-v$Version-win-x64.zip"
$url = "https://nodejs.org/dist/v$Version/$zipName"
$innerFolder = "node-v$Version-win-x64"
$entryPath = "$innerFolder/node.exe"

if (-not (Test-Path $releaseRoot)) {
    Write-Error "Missing release\ folder. Run scripts\build-release.bat first."
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
$zipPath = Join-Path $env:TEMP $zipName
$outExe = Join-Path $runtimeDir "node.exe"

Write-Host "[ctrack] Downloading Node v$Version ($url)..."
Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

Write-Host "[ctrack] Extracting node.exe only..."
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entry = $zip.GetEntry($entryPath)
    if ($null -eq $entry) {
        Write-Error "Zip missing entry: $entryPath"
    }
    $destStream = [System.IO.File]::Create($outExe)
    try {
        $srcStream = $entry.Open()
        try {
            $srcStream.CopyTo($destStream)
        } finally {
            $srcStream.Dispose()
        }
    } finally {
        $destStream.Dispose()
    }
} finally {
    $zip.Dispose()
}

Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

Write-Host "[ctrack] Embedded: $outExe"
