#Requires -Version 5.1
<#
  Provisions CTrack app icon across engine, web, tray, and installer branding.
  Master source: engine/assets/ctrack-engine-icon.png

  Run: powershell -File scripts/provision-app-icons.ps1
       powershell -File scripts/provision-app-icons.ps1 -SourcePath "path\to\icon.png"
#>
param(
  [string]$SourcePath = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$engineAssets = Join-Path $repoRoot "engine\assets"
$webPublic = Join-Path $repoRoot "web\public"
$branding = Join-Path $repoRoot "installer\branding"
$master = if ($SourcePath) { (Resolve-Path $SourcePath).Path } else { Join-Path $engineAssets "ctrack-engine-icon.png" }

if (!(Test-Path -LiteralPath $master)) {
  throw "Master icon not found: $master"
}

foreach ($dir in @($engineAssets, $webPublic, $branding)) {
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}

function Save-PngCopy {
  param([string]$Dest)
  Copy-Item -LiteralPath $master -Destination $Dest -Force
}

function New-SquarePng {
  param([string]$Dest, [int]$Size, [int]$Padding = 0)
  $loaded = [System.Drawing.Image]::FromFile($master)
  try {
    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.Clear([System.Drawing.Color]::FromArgb(255, 11, 17, 24))
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $inner = $Size - (2 * $Padding)
      $side = [Math]::Min($loaded.Width, $loaded.Height)
      $sx = [int](($loaded.Width - $side) / 2)
      $sy = [int](($loaded.Height - $side) / 2)
      $inner = $Size - (2 * $Padding)
      $g.DrawImage($loaded, $Padding, $Padding, $inner, $inner)
    } finally { $g.Dispose() }
    $bmp.Save($Dest, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $loaded.Dispose() }
}

function New-TallBrandingPng {
  param([string]$Dest, [int]$W = 480, [int]$H = 920)
  $loaded = [System.Drawing.Image]::FromFile($master)
  try {
    $bmp = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.Clear([System.Drawing.Color]::FromArgb(255, 11, 17, 24))
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $iconSize = [int]([Math]::Min($W, $H) * 0.42)
      $x = [int](($W - $iconSize) / 2)
      $y = [int](($H - $iconSize) * 0.28)
      $g.DrawImage($loaded, $x, $y, $iconSize, $iconSize)
      $font = New-Object System.Drawing.Font("Segoe UI Semibold", 22, [System.Drawing.FontStyle]::Regular)
      try {
        $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 232, 238, 245))
        $accent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 36, 225, 177))
        $title = "CTrack Publish"
        $sub = "Engine"
        $sf = New-Object System.Drawing.StringFormat
        $sf.Alignment = [System.Drawing.StringAlignment]::Center
        $g.DrawString($title, $font, $brush, (New-Object System.Drawing.RectangleF(0, ($y + $iconSize + 36), $W, 40)), $sf)
        $font2 = New-Object System.Drawing.Font("Segoe UI", 16)
        try {
          $g.DrawString($sub, $font2, $accent, (New-Object System.Drawing.RectangleF(0, ($y + $iconSize + 72), $W, 30)), $sf)
        } finally { $font2.Dispose() }
      } finally {
        $brush.Dispose()
        $accent.Dispose()
        $font.Dispose()
      }
    } finally { $g.Dispose() }
    $bmp.Save($Dest, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $loaded.Dispose() }
}

function New-MultiSizeIco {
  param([string]$Dest, [int[]]$Sizes = @(16, 32, 48, 256))
  $srcBmp = [System.Drawing.Bitmap]::FromFile($master)
  try {
    $side = [Math]::Min($srcBmp.Width, $srcBmp.Height)
    $sx = [int](($srcBmp.Width - $side) / 2)
    $sy = [int](($srcBmp.Height - $side) / 2)
    $square = New-Object System.Drawing.Bitmap $side, $side
    $sg = [System.Drawing.Graphics]::FromImage($square)
    try {
      $sg.DrawImage($srcBmp, 0, 0, $side, $side)
    } finally { $sg.Dispose() }
    $images = New-Object System.Collections.Generic.List[System.Drawing.Bitmap]
    foreach ($s in $Sizes) {
      $b = New-Object System.Drawing.Bitmap $s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $g = [System.Drawing.Graphics]::FromImage($b)
      try {
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $pad = [Math]::Max(1, [int]($s * 0.06))
        $inner = $s - (2 * $pad)
        $g.DrawImage($square, $pad, $pad, $inner, $inner)
      } finally { $g.Dispose() }
      [void]$images.Add($b)
    }
    Save-BitmapsAsIcon -Images $images -Dest $Dest
    foreach ($img in $images) { $img.Dispose() }
    $square.Dispose()
  } finally { $srcBmp.Dispose() }
}

function Save-BitmapsAsIcon {
  param([System.Collections.Generic.List[System.Drawing.Bitmap]]$Images, [string]$Dest)
  $ms = New-Object System.IO.MemoryStream
  try {
    $bw = New-Object System.IO.BinaryWriter($ms)
    $bw.Write([UInt16]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]$Images.Count)
    $offset = 6 + (16 * $Images.Count)
    $pngData = New-Object System.Collections.Generic.List[byte[]]
    foreach ($img in $Images) {
      $pms = New-Object System.IO.MemoryStream
      $img.Save($pms, [System.Drawing.Imaging.ImageFormat]::Png)
      $pngData.Add($pms.ToArray())
      $pms.Dispose()
    }
    for ($i = 0; $i -lt $Images.Count; $i++) {
      $img = $Images[$i]
      $w = if ($img.Width -ge 256) { [byte]0 } else { [byte]$img.Width }
      $h = if ($img.Height -ge 256) { [byte]0 } else { [byte]$img.Height }
      $bw.Write($w)
      $bw.Write($h)
      $bw.Write([byte]0)
      $bw.Write([byte]0)
      $bw.Write([UInt16]1)
      $bw.Write([UInt16]32)
      $bw.Write([UInt32]$pngData[$i].Length)
      $bw.Write([UInt32]$offset)
      $offset += $pngData[$i].Length
    }
    foreach ($d in $pngData) { $bw.Write($d) }
    $bw.Flush()
    [System.IO.File]::WriteAllBytes($Dest, $ms.ToArray())
  } finally { $ms.Dispose() }
}

Write-Host "[icons] Master: $master"

if ($SourcePath -and ((Resolve-Path $SourcePath).Path -ne (Join-Path $engineAssets "ctrack-engine-icon.png"))) {
  Copy-Item -LiteralPath $master -Destination (Join-Path $engineAssets "ctrack-engine-icon.png") -Force
}

Save-PngCopy (Join-Path $webPublic "ctrack-icon.png")
Save-PngCopy (Join-Path $webPublic "favicon.png")
Save-PngCopy (Join-Path $branding "app-icon.png")

New-MultiSizeIco -Dest (Join-Path $engineAssets "ctrack-tray.ico")
New-MultiSizeIco -Dest (Join-Path $branding "app-icon.ico")
$releaseIco = Join-Path $repoRoot "release\engine\assets\ctrack-tray.ico"
if (Test-Path (Split-Path $releaseIco -Parent)) {
  New-MultiSizeIco -Dest $releaseIco
}

New-SquarePng -Dest (Join-Path $branding "wizard-small.png") -Size 512 -Padding 48
New-TallBrandingPng -Dest (Join-Path $branding "wizard-large.png")

$normalize = Join-Path $branding "normalize-wizard-images.ps1"
if (Test-Path $normalize) {
  & $normalize
}

Write-Host "[icons] Engine: engine/assets/ctrack-engine-icon.png + ctrack-tray.ico"
Write-Host "[icons] Web: web/public/ctrack-icon.png + favicon.png"
Write-Host "[icons] Installer: installer/branding/app-icon.ico + wizard BMPs"
