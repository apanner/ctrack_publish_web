# Ensures engine/runtime has FFmpeg, OpenImageIO (oiiotool), and OCIO config.
# Used by: npm postinstall (dev), build-python-runtime.ps1 (release installer).

param(
  [Parameter(Mandatory = $false)]
  [string]$TargetRoot = "",
  [switch]$Force,
  [switch]$Provision
)

$ErrorActionPreference = "Stop"

if ($env:CTRACK_SKIP_POSTINSTALL_RUNTIME -eq '1' -and -not $Provision) {
  Write-Host '[ctrack] Skipping media runtime download (CTRACK_SKIP_POSTINSTALL_RUNTIME=1).'
  exit 0
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if ($TargetRoot) {
  $engineRoot = Resolve-Path $TargetRoot
} else {
  $engineRoot = Join-Path $repoRoot "engine"
}

$runtimeRoot = Join-Path $engineRoot "runtime"
$ffmpegDir = Join-Path $runtimeRoot "ffmpeg"
$oiioDir = Join-Path $runtimeRoot "oiio"
$ocioDir = Join-Path $runtimeRoot "ocio"
$cacheDir = Join-Path $repoRoot ".cache"

New-Item -ItemType Directory -Force -Path $cacheDir, $runtimeRoot, $ocioDir | Out-Null

function Download-File {
  param(
    [Parameter(Mandatory = $true)][string[]]$Urls,
    [Parameter(Mandatory = $true)][string]$Destination,
    [int64]$MinBytes = 1
  )
  if ((Test-Path $Destination) -and !$Force) {
    $cached = Get-Item -LiteralPath $Destination
    if ($cached.Length -ge $MinBytes) {
      Write-Host "[ctrack] Using cached $(Split-Path $Destination -Leaf) ($([math]::Round($cached.Length / 1MB, 1)) MB)"
      return
    }
    Write-Warning "[ctrack] Cached file too small ($($cached.Length) bytes) - re-downloading"
    Remove-Item -LiteralPath $Destination -Force
  }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $headers = @{
    'User-Agent' = 'CTrack-Engine/1.0 (Windows media-runtime-provision)'
    'Accept'     = '*/*'
  }
  $lastError = $null
  foreach ($url in $Urls) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      try {
        Write-Host "[ctrack] Downloading $url (attempt $attempt/3)"
        Invoke-WebRequest -Uri $url -OutFile $Destination -UseBasicParsing -Headers $headers -TimeoutSec 600
        $size = (Get-Item -LiteralPath $Destination).Length
        if ($size -lt $MinBytes) {
          throw "Downloaded file too small ($($size) bytes)"
        }
        Write-Host "[ctrack] Downloaded $(Split-Path $Destination -Leaf) ($([math]::Round($size / 1MB, 1)) MB)"
        return
      } catch {
        $lastError = $_
        Write-Warning "[ctrack] Download failed: $($_.Exception.Message)"
        if (Test-Path $Destination) { Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue }
        if ($attempt -lt 3) { Start-Sleep -Seconds (5 * $attempt) }
      }
    }
  }
  throw "Failed to download after retries: $($Urls -join ', '). Last error: $lastError"
}

function Ensure-FfmpegRuntime {
  if ((Test-Path (Join-Path $ffmpegDir "ffmpeg.exe")) -and !$Force) {
    return
  }
  # Official Windows builds per https://ffmpeg.org/download.html#build-windows (BtbN on GitHub).
  # gyan.dev is listed there too but often returns 503 - use as last resort only.
  $btbnBase = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'
  $ffmpegUrls = @(
    "$btbnBase/ffmpeg-n7.1-latest-win64-gpl-7.1.zip",
    "$btbnBase/ffmpeg-n8.1-latest-win64-gpl-8.1.zip",
    "$btbnBase/ffmpeg-master-latest-win64-gpl.zip",
    'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
  )
  $ffmpegZip = Join-Path $cacheDir "ffmpeg-win64-gpl.zip"
  $ffmpegExtractDir = Join-Path $cacheDir "ffmpeg-extract"
  if (Test-Path $ffmpegDir) { Remove-Item -Recurse -Force $ffmpegDir }
  if (Test-Path $ffmpegExtractDir) { Remove-Item -Recurse -Force $ffmpegExtractDir }
  New-Item -ItemType Directory -Force -Path $ffmpegDir, $ffmpegExtractDir | Out-Null
  Download-File -Urls $ffmpegUrls -Destination $ffmpegZip -MinBytes 10MB
  Expand-Archive -Path $ffmpegZip -DestinationPath $ffmpegExtractDir -Force
  $ffmpegExe = Get-ChildItem -Path $ffmpegExtractDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
  $ffprobeExe = Get-ChildItem -Path $ffmpegExtractDir -Recurse -Filter "ffprobe.exe" | Select-Object -First 1
  if (!$ffmpegExe) { throw "ffmpeg.exe not found in downloaded archive" }
  Copy-Item $ffmpegExe.FullName (Join-Path $ffmpegDir "ffmpeg.exe") -Force
  if ($ffprobeExe) {
    Copy-Item $ffprobeExe.FullName (Join-Path $ffmpegDir "ffprobe.exe") -Force
  }
  # Copy sibling DLLs (BtbN full builds ship codecs in bin/).
  $binDir = $ffmpegExe.Directory
  Get-ChildItem -Path $binDir -Filter "*.dll" -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $ffmpegDir $_.Name) -Force
  }
  Remove-Item -Recurse -Force $ffmpegExtractDir
  Write-Host "[ctrack] FFmpeg ready: $ffmpegDir"
}

function Ensure-OiioRuntime {
  $oiiotool = Get-ChildItem -Path $oiioDir -Recurse -Filter "oiiotool.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($oiiotool -and !$Force) {
    Write-Host "[ctrack] OpenImageIO ready: $($oiiotool.FullName)"
    return
  }
  if (Test-Path $oiioDir) { Remove-Item -Recurse -Force $oiioDir }
  New-Item -ItemType Directory -Force -Path $oiioDir | Out-Null

  $oiioZip = Join-Path $cacheDir "OpenImageIO.zip"
  $extractTo = Join-Path $cacheDir "oiio-extract"
  if (Test-Path $extractTo) { Remove-Item -Recurse -Force $extractTo }
  Download-File -Urls @(
    'https://github.com/pitvfx/OpenImageIO/releases/download/v1.0.0/OpenImageIO.zip'
  ) -Destination $oiioZip
  Expand-Archive -Path $oiioZip -DestinationPath $extractTo -Force

  $found = Get-ChildItem -Path $extractTo -Recurse -Filter "oiiotool.exe" | Select-Object -First 1
  if (!$found) { throw "oiiotool.exe not found in OpenImageIO archive" }

  $oiioRoot = $found.Directory
  if ($found.Directory.Name -eq "bin") {
    $oiioRoot = $found.Directory.Parent
  }
  Get-ChildItem -Path $oiioRoot | ForEach-Object {
    $dest = Join-Path $oiioDir $_.Name
    if ($_.PSIsContainer) {
      Copy-Item $_.FullName $dest -Recurse -Force
    } else {
      Copy-Item $_.FullName $dest -Force
    }
  }
  Remove-Item -Recurse -Force $extractTo
  Write-Host "[ctrack] OpenImageIO ready: $oiioDir"
}

function Ensure-OcioRuntime {
  $acesConfig = Join-Path $ocioDir "aces_1.2\config.ocio"
  $bundledCg = Join-Path $ocioDir "cg-config-v1.0.0_aces-v1.3_ocio-v2.1.ocio"

  if ((Test-Path $acesConfig) -and !$Force) {
    Write-Host "[ctrack] OCIO aces_1.2 ready: $acesConfig"
    return
  }

  $nukeAcesPaths = @(
    "C:\Program Files\Nuke15.1v4\plugins\OCIOConfigs\configs\aces_1.2",
    "C:\Program Files\Nuke14.0v5\plugins\OCIOConfigs\configs\aces_1.2",
    "C:\Program Files\Nuke13.2v5\plugins\OCIOConfigs\configs\aces_1.2"
  )
  foreach ($src in $nukeAcesPaths) {
    if (Test-Path (Join-Path $src "config.ocio")) {
      $dest = Join-Path $ocioDir "aces_1.2"
      if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
      Write-Host "[ctrack] Copying OCIO aces_1.2 from $src"
      Copy-Item $src $dest -Recurse -Force
      Write-Host "[ctrack] OCIO aces_1.2 ready: $acesConfig"
      return
    }
  }

  if (!(Test-Path $bundledCg) -or $Force) {
    Download-File -Urls @(
      'https://github.com/AcademySoftwareFoundation/OpenColorIO-Config-ACES/releases/download/v2.1.0-v2.2.0/cg-config-v2.1.0_aces-v1.3_ocio-v2.2.ocio'
    ) -Destination $bundledCg
  }
  Write-Host "[ctrack] OCIO fallback (cg-config): $bundledCg"
  Write-Host "[ctrack] Tip: install Nuke once and re-run pack to embed full aces_1.2 for exact sample.nk parity."
}

Write-Host "[ctrack] Ensuring runtime under: $engineRoot"
Ensure-FfmpegRuntime
Ensure-OiioRuntime
Ensure-OcioRuntime
Write-Host "[ctrack] Runtime dependencies ready."
