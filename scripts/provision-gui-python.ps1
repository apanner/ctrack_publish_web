#Requires -Version 5.1
<#
  Provisions portable Python (with Tcl/Tk) + GUI deps for CTrack Engine.
  Uses python-build-standalone install_only_stripped (includes tkinter).

  Dev:  engine/runtime/python
  Release: release/engine/runtime/python (via build-python-runtime.ps1)

  Run: powershell -File scripts/provision-gui-python.ps1
#>
param(
  [string]$TargetRoot = "",
  [string]$PythonVersion = "3.11.9",
  [string]$StandaloneTag = "20240726",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if ($TargetRoot) {
  $engineRoot = Resolve-Path $TargetRoot
} else {
  $engineRoot = Join-Path $repoRoot "engine"
}

$runtimeRoot = Join-Path $engineRoot "runtime"
$pythonDir = Join-Path $runtimeRoot "python"
$cacheDir = Join-Path $repoRoot ".cache"
$archiveName = "cpython-$PythonVersion+$StandaloneTag-x86_64-pc-windows-msvc-install_only_stripped.tar.gz"
$standaloneTar = Join-Path $cacheDir $archiveName
$getPip = Join-Path $cacheDir "get-pip.py"

New-Item -ItemType Directory -Force -Path $cacheDir, $runtimeRoot | Out-Null

function Download-File($Url, $Destination) {
  if ((Test-Path $Destination) -and !$Force) { return }
  Write-Host "[gui] Downloading $Url"
  Invoke-WebRequest -Uri $Url -OutFile $Destination
}

function Install-StandalonePython {
  if ((Test-Path (Join-Path $pythonDir "python.exe")) -and !$Force) {
    & (Join-Path $pythonDir "python.exe") -c "import tkinter" 2>$null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "[gui] Portable Python already present: $pythonDir"
      return
    }
  }

  $url = "https://github.com/astral-sh/python-build-standalone/releases/download/$StandaloneTag/$archiveName"
  Download-File $url $standaloneTar

  $extractRoot = Join-Path $cacheDir "standalone-$PythonVersion-$StandaloneTag"
  if (Test-Path $extractRoot) { Remove-Item -Recurse -Force $extractRoot }
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null

  Write-Host "[gui] Extracting portable Python..."
  tar -xzf $standaloneTar -C $extractRoot
  $inner = Join-Path $extractRoot "python"
  if (!(Test-Path (Join-Path $inner "python.exe"))) {
    throw "Expected python.exe under $inner"
  }

  if (Test-Path $pythonDir) { Remove-Item -Recurse -Force $pythonDir }
  New-Item -ItemType Directory -Force -Path $pythonDir | Out-Null
  Copy-Item -Path (Join-Path $inner "*") -Destination $pythonDir -Recurse -Force
}

Install-StandalonePython

if (!(Test-Path $getPip)) {
  Download-File "https://bootstrap.pypa.io/get-pip.py" $getPip
}

$pythonExe = Join-Path $pythonDir "python.exe"
$sitePackages = Join-Path (Join-Path $pythonDir "Lib") "site-packages"
New-Item -ItemType Directory -Force -Path $sitePackages | Out-Null

& $pythonExe $getPip --no-warn-script-location 2>$null
if ($LASTEXITCODE -ne 0) { & $pythonExe $getPip --no-warn-script-location }

$packages = @(
  "customtkinter==5.2.2",
  "pystray==0.19.5",
  "Pillow==10.4.0",
  "requests==2.32.3",
  "opencv-python-headless",
  "ffmpeg-python"
)

Write-Host "[gui] Installing packages into $sitePackages ..."
& $pythonExe -m pip install --no-cache-dir --upgrade @packages
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Write-Host "[gui] Verifying GUI imports..."
& $pythonExe -c "import tkinter, customtkinter, pystray, PIL, requests; print('gui python ok')"
if ($LASTEXITCODE -ne 0) { throw "GUI verification failed" }

Write-Host "[gui] Portable Python ready: $pythonExe"
