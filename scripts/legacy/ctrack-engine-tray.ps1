# CTrack Publish Engine - system tray host (Windows).

param([string]$InstallRoot = "")

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

. (Join-Path $PSScriptRoot "ctrack-engine-tray-settings.ps1")

if (!$InstallRoot) {
  $InstallRoot = Split-Path -Parent $PSScriptRoot
} else {
  $InstallRoot = (Resolve-Path $InstallRoot).Path
}
# Dev: scripts\start-engine-tray.bat may pass repo root; release: install root contains engine\
if (!(Test-Path (Join-Path $InstallRoot "engine\dist\server.js"))) {
  $parent = Split-Path -Parent $InstallRoot
  if (Test-Path (Join-Path $parent "engine\dist\server.js")) {
    $InstallRoot = $parent
  }
}
$InstallRoot = (Resolve-Path $InstallRoot).Path
$EngineDir = Join-Path $InstallRoot "engine"
$TrayBatPath = Join-Path $PSScriptRoot "start-engine-tray.bat"
$NodeExe = "node"
if (Test-Path (Join-Path $InstallRoot "runtime\node.exe")) {
  $NodeExe = Join-Path $InstallRoot "runtime\node.exe"
}
$ServerJs = Join-Path $EngineDir "dist\server.js"

$script:WebUrl = "https://ctrackpublishweb.vercel.app/"
$script:NotifyOnMissing = $true
$script:PollIntervalMs = 8000

$HealthUrl = "http://127.0.0.1:7777/health"
$StatusUrl = "http://127.0.0.1:7777/api/engine/status"
$SettingsUrl = "http://127.0.0.1:7777/api/engine/settings"

$script:EngineProcess = $null
$script:LastStatus = $null
$script:LastBalloonAt = [datetime]::MinValue

function Sync-TrayPreferencesFromEngine {
  try {
    $s = Invoke-RestMethod -Uri $SettingsUrl -TimeoutSec 3
    if ($s.ok -and $s.tray) {
      if ($s.tray.webUrl) { $script:WebUrl = $s.tray.webUrl }
      $script:NotifyOnMissing = ($s.tray.notifyOnMissingTools -ne $false)
      if ($s.tray.pollIntervalSec) {
        $script:PollIntervalMs = [Math]::Max(3000, [int]$s.tray.pollIntervalSec * 1000)
      }
    }
  } catch { }
}

function Get-SetupUrl { return ($script:WebUrl.TrimEnd("/") + "/setup") }

function Start-EngineProcess {
  if ($script:EngineProcess -and !$script:EngineProcess.HasExited) { return }
  if (!(Test-Path $ServerJs)) {
    [System.Windows.Forms.MessageBox]::Show(
      "Engine not found: $ServerJs`nRun pack:release or build the engine first.",
      "CTrack Engine",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    return
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $NodeExe
  $psi.Arguments = "dist\server.js"
  $psi.WorkingDirectory = $EngineDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $script:EngineProcess = [System.Diagnostics.Process]::Start($psi)
}

function Stop-EngineProcess {
  if ($script:EngineProcess -and !$script:EngineProcess.HasExited) {
    try { $script:EngineProcess.Kill() } catch { }
    $script:EngineProcess.WaitForExit(5000)
  }
  $script:EngineProcess = $null
}

function Restart-Engine {
  Stop-EngineProcess
  Start-Sleep -Milliseconds 800
  Start-EngineProcess
}

function Test-EngineHealthy {
  try {
    $r = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Get-EngineRuntimeStatus {
  try {
    $r = Invoke-WebRequest -Uri $StatusUrl -UseBasicParsing -TimeoutSec 4
    if ($r.StatusCode -ne 200) { return $null }
    return ($r.Content | ConvertFrom-Json)
  } catch { return $null }
}

function Invoke-EngineRescan {
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:7777/api/engine/rescan" -Method POST -UseBasicParsing -TimeoutSec 30 | Out-Null
    $script:LastStatus = Get-EngineRuntimeStatus
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Rescan failed: $_", "CTrack Engine") | Out-Null
  }
}

function Format-ToolLine($label, $tool) {
  if ($tool -and $tool.available) { return "$label OK" }
  return "$label --"
}

function Update-TrayFromStatus($notify) {
  if ($script:EngineProcess -and $script:EngineProcess.HasExited) {
    $notify.Text = "CTrack Engine (stopped)"
    return
  }
  if (!(Test-EngineHealthy)) {
    $notify.Text = "CTrack Engine - starting..."
    return
  }
  $st = $script:LastStatus
  if (!$st) {
    $notify.Text = "CTrack Engine - running (7777)"
    return
  }
  $exr = if ($st.activeExrBackend) { $st.activeExrBackend } else { "none" }
  $nukeN = if ($st.nukeInstallations) { @($st.nukeInstallations).Count } else { 0 }
  $t = $st.tools
  $nukeLine = Format-ToolLine "Nuke" $t.nuke
  $oiioLine = Format-ToolLine "OIIO" $t.oiiotool
  $notify.Text = "CTrack - EXR:$exr | $nukeLine ($nukeN) | $oiioLine"
}

$iconPath = Join-Path $EngineDir "assets\ctrack-tray.ico"
if (!(Test-Path $iconPath)) {
  $iconPath = Get-CtrackEngineIconPath -EngineDir $EngineDir
  if ($iconPath -and $iconPath.EndsWith(".png")) {
    $icoPath = Join-Path $EngineDir "assets\ctrack-tray.ico"
    Convert-CtrackPngToIco -PngPath $iconPath -IcoPath $icoPath | Out-Null
    if (Test-Path $icoPath) { $iconPath = $icoPath }
  }
}
$icon = if ($iconPath -and (Test-Path $iconPath) -and $iconPath.EndsWith(".ico")) {
  New-Object System.Drawing.Icon $iconPath
} else {
  [System.Drawing.SystemIcons]::Application
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $icon
$notify.Text = "CTrack Publish Engine"
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$null = $menu.Items.Add("CTrack Publish Engine", $null, $null).Enabled = $false
$statusItem = $menu.Items.Add("Loading runtime status...", $null, $null)
$statusItem.Enabled = $false
$null = $menu.Items.Add("-")
$null = $menu.Items.Add("Open hosted web UI", $null, { Start-Process $script:WebUrl })
$null = $menu.Items.Add("Settings...", $null, {
  $applied = Show-CtrackEngineSettingsDialog -InstallRoot $InstallRoot -EngineDir $EngineDir -TrayBatPath $TrayBatPath -OnApplied {
    param($saved, $webUrl)
    $script:WebUrl = $webUrl
    Sync-TrayPreferencesFromEngine
    if ($timer) { $timer.Interval = $script:PollIntervalMs }
    $script:LastStatus = Get-EngineRuntimeStatus
    Update-TrayFromStatus $notify
  }
  if ($applied) { Sync-TrayPreferencesFromEngine }
})
$null = $menu.Items.Add("Open setup in browser", $null, { Start-Process (Get-SetupUrl) })
$null = $menu.Items.Add("Open engine API", $null, { Start-Process "http://127.0.0.1:7777/" })
$null = $menu.Items.Add("Open engine folder", $null, { Start-Process "explorer.exe" $EngineDir })
$null = $menu.Items.Add("-")
$null = $menu.Items.Add("Rescan Nuke / tools", $null, {
  Invoke-EngineRescan
  Update-TrayFromStatus $notify
})
$null = $menu.Items.Add("Restart engine", $null, { Restart-Engine })
$null = $menu.Items.Add("Quit", $null, {
  Stop-EngineProcess
  $notify.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$notify.ContextMenuStrip = $menu

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $script:PollIntervalMs
$timer.Add_Tick({
  if (Test-EngineHealthy) {
    $script:LastStatus = Get-EngineRuntimeStatus
    if ($script:LastStatus -and $statusItem) {
      $miss = @($script:LastStatus.missing)
      if ($miss.Count -gt 0) {
        $statusItem.Text = "Missing: " + ($miss -join ", ")
        if ($script:NotifyOnMissing) {
          $now = Get-Date
          if (($now - $script:LastBalloonAt).TotalMinutes -ge 5) {
            $script:LastBalloonAt = $now
            $notify.ShowBalloonTip(8000, "CTrack Engine", "Missing tools: " + ($miss -join ", "), [System.Windows.Forms.ToolTipIcon]::Warning)
          }
        }
      } else {
        $exr = $script:LastStatus.activeExrBackend
        $nukeN = @($script:LastStatus.nukeInstallations).Count
        $statusItem.Text = "EXR: $exr | Nuke: $nukeN | Settings for full control"
      }
    }
  }
  Update-TrayFromStatus $notify
})
$timer.Start()

$notify.Add_DoubleClick({ Start-Process $script:WebUrl })

Start-EngineProcess
Start-Sleep -Seconds 3
Sync-TrayPreferencesFromEngine
$timer.Interval = $script:PollIntervalMs
[System.Windows.Forms.Application]::Run()
