#Requires -Version 5.1
<#
  Builds Inno-safe wizard bitmaps (24-bit BMP — maximally compatible with Setup.exe / all DPI).

  Outputs:
    wizard-large.bmp  → 240×459 (aspect 164:314, matches Inno default bitmap ratio)
    wizard-small.bmp → 147×147 (square; same as Inno's built-in small graphic size)

  Source (first match per name): wizard-large.png|bmp|jpg, wizard-small.png|bmp|jpg
  If a source is missing, a simple dark VFX-style solid fill is used (no external file required).

  Run: powershell -File installer/branding/normalize-wizard-images.ps1
#>
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$fmtRgb = [System.Drawing.Imaging.PixelFormat]::Format24bppRgb

function Resolve-ArtSource([string]$baseName) {
    foreach ($ext in @(".png", ".bmp", ".jpg", ".jpeg")) {
        $p = Join-Path $here ($baseName + $ext)
        if (Test-Path -LiteralPath $p) {
            return $p
        }
    }
    return $null
}

function Load-ImageUnlocked([string]$path) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $ms = New-Object System.IO.MemoryStream(, $bytes)
    return @{
        Image = [System.Drawing.Image]::FromStream($ms)
        Stream = $ms
    }
}

function Save-Bmp([System.Drawing.Bitmap]$bmp, [string]$path) {
    $tmp = $path + ".writing.bmp"
    $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Bmp)
    Copy-Item -LiteralPath $tmp -Destination $path -Force
    Remove-Item $tmp -Force
}

function New-BitmapRgb([int]$w, [int]$h) {
    return New-Object System.Drawing.Bitmap($w, $h, $fmtRgb)
}

function Fill-DarkVfxBackground([System.Drawing.Graphics]$g, [int]$w, [int]$h) {
    $g.Clear([System.Drawing.Color]::FromArgb(255, 10, 12, 18))
}

# --- Large sidebar 240×459 ---
$lw = 240
$lh = 459
$largeOut = Join-Path $here "wizard-large.bmp"
$srcPathL = Resolve-ArtSource "wizard-large"
$bmpL = New-BitmapRgb $lw $lh
$g = [System.Drawing.Graphics]::FromImage($bmpL)
try {
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    Fill-DarkVfxBackground $g $lw $lh
    if ($null -ne $srcPathL) {
        $p = Load-ImageUnlocked $srcPathL
        try {
            $src = $p.Image
            $sw = [double]$src.Width
            $sh = [double]$src.Height
            $scale = [Math]::Max($lw / $sw, $lh / $sh)
            $nw = [int][Math]::Ceiling($sw * $scale)
            $nh = [int][Math]::Ceiling($sh * $scale)
            $dx = [int](($lw - $nw) / 2)
            $dy = [int](($lh - $nh) / 2)
            $g.DrawImage($src, $dx, $dy, $nw, $nh)
        } finally {
            $p.Image.Dispose()
            $p.Stream.Dispose()
        }
    }
} finally {
    $g.Dispose()
}
try {
    Save-Bmp $bmpL $largeOut
    Write-Host "[branding] wrote ${lw}x${lh} BMP -> $largeOut"
} finally {
    $bmpL.Dispose()
}

# --- Small square 147×147 ---
$ss = 147
$smallOut = Join-Path $here "wizard-small.bmp"
$srcPathS = Resolve-ArtSource "wizard-small"
$bmpS = New-BitmapRgb $ss $ss
$g2 = [System.Drawing.Graphics]::FromImage($bmpS)
try {
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    Fill-DarkVfxBackground $g2 $ss $ss
    if ($null -ne $srcPathS) {
        $p2 = Load-ImageUnlocked $srcPathS
        try {
            $src2 = $p2.Image
            $side = [Math]::Min($src2.Width, $src2.Height)
            $sx = [int](($src2.Width - $side) / 2)
            $sy = [int](($src2.Height - $side) / 2)
            $cropRect = New-Object System.Drawing.Rectangle($sx, $sy, $side, $side)
            $destRect = New-Object System.Drawing.Rectangle(0, 0, $ss, $ss)
            $g2.DrawImage($src2, $destRect, $cropRect, [System.Drawing.GraphicsUnit]::Pixel)
        } finally {
            $p2.Image.Dispose()
            $p2.Stream.Dispose()
        }
    }
} finally {
    $g2.Dispose()
}
try {
    Save-Bmp $bmpS $smallOut
    Write-Host "[branding] wrote ${ss}x${ss} BMP -> $smallOut"
} finally {
    $bmpS.Dispose()
}
