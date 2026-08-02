# CTrack Engine settings API + modern WPF settings window.

function Get-CtrackSettingsBundle {
  param([string]$BaseUrl = "http://127.0.0.1:7777")
  try {
    $r = Invoke-RestMethod -Uri "$BaseUrl/api/engine/settings" -TimeoutSec 8
    if ($r.ok) { return $r }
  } catch { }
  return $null
}

function Save-CtrackSettingsBundle {
  param(
    [hashtable]$EnginePatch,
    [hashtable]$TrayPatch,
    [string]$BaseUrl = "http://127.0.0.1:7777"
  )
  $body = @{ engine = $EnginePatch; tray = $TrayPatch } | ConvertTo-Json -Depth 6 -Compress
  return Invoke-RestMethod -Uri "$BaseUrl/api/engine/settings" -Method PATCH -Body $body -ContentType "application/json" -TimeoutSec 15
}

function Set-CtrackLaunchAtLogin {
  param([bool]$Enabled, [string]$TrayBatPath)
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  $name = "CTrackPublishEngine"
  if ($Enabled) {
    Set-ItemProperty -Path $key -Name $name -Value "`"$TrayBatPath`"" -Type String
  } else {
    Remove-ItemProperty -Path $key -Name $name -ErrorAction SilentlyContinue
  }
}

function Get-CtrackEngineIconPath {
  param([string]$EngineDir)
  $ico = Join-Path $EngineDir "assets\ctrack-tray.ico"
  $png = Join-Path $EngineDir "assets\ctrack-engine-icon.png"
  if (Test-Path $ico) { return $ico }
  if (Test-Path $png) { return $png }
  return $null
}

function Convert-CtrackPngToIco {
  param([string]$PngPath, [string]$IcoPath)
  if (!(Test-Path $PngPath)) { return $false }
  Add-Type -AssemblyName System.Drawing
  $bmp = [System.Drawing.Bitmap]::FromFile($PngPath)
  $hIcon = $bmp.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($hIcon)
  $fs = [System.IO.File]::Create($IcoPath)
  $icon.Save($fs)
  $fs.Close()
  $icon.Dispose()
  $bmp.Dispose()
  return $true
}

function Show-CtrackEngineSettingsDialog {
  param(
    [string]$InstallRoot,
    [string]$EngineDir,
    [string]$TrayBatPath,
    [scriptblock]$OnApplied
  )

  $baseUrl = "http://127.0.0.1:7777"
  $bundle = Get-CtrackSettingsBundle -BaseUrl $baseUrl
  if (!$bundle) {
    [System.Windows.Forms.MessageBox]::Show(
      "Engine is not running on port 7777.`nStart the tray engine first, then open Settings again.",
      "CTrack Engine",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
    return $false
  }

  $pngIcon = Join-Path $EngineDir "assets\ctrack-engine-icon.png"
  $icoIcon = Join-Path $EngineDir "assets\ctrack-tray.ico"
  if (!(Test-Path $icoIcon) -and (Test-Path $pngIcon)) {
    Convert-CtrackPngToIco -PngPath $pngIcon -IcoPath $icoIcon | Out-Null
  }

  Add-Type -AssemblyName PresentationFramework
  Add-Type -AssemblyName PresentationCore
  Add-Type -AssemblyName WindowsBase
  Add-Type -AssemblyName System.Windows.Forms

  $xamlPath = Join-Path $PSScriptRoot "ctrack-settings-window.xaml"
  if (!(Test-Path $xamlPath)) {
    [System.Windows.Forms.MessageBox]::Show("Missing UI file: $xamlPath", "CTrack Engine") | Out-Null
    return $false
  }

  [xml]$xaml = Get-Content $xamlPath -Raw
  $reader = New-Object System.Xml.XmlNodeReader $xaml
  $window = [Windows.Markup.XamlReader]::Load($reader)

  if (Test-Path $pngIcon) {
    $logo = $window.FindName("AppLogo")
    $bi = New-Object System.Windows.Media.Imaging.BitmapImage
    $bi.BeginInit()
    $bi.UriSource = [Uri]((Resolve-Path $pngIcon).Path)
    $bi.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $bi.EndInit()
    $logo.Source = $bi
  }
  if (Test-Path $icoIcon) {
    try {
      $fs = New-Object System.IO.FileStream($icoIcon, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read)
      $decoder = [System.Windows.Media.Imaging.IconBitmapDecoder]::new($fs, [System.Windows.Media.Imaging.BitmapCreateOptions]::None, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
      $window.Icon = $decoder.Frames[0]
      $fs.Close()
    } catch { }
  } elseif (Test-Path $pngIcon) {
    try {
      $bi2 = New-Object System.Windows.Media.Imaging.BitmapImage
      $bi2.BeginInit()
      $bi2.UriSource = [Uri]((Resolve-Path $pngIcon).Path)
      $bi2.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
      $bi2.EndInit()
      $window.Icon = $bi2
    } catch { }
  }

  $script:CustomNukeExe = $null
  $script:Bundle = $bundle
  $script:BaseUrl = $baseUrl
  $script:EngineDir = $EngineDir

  $pages = @(
    $window.FindName("PageGeneral"),
    $window.FindName("PageReview"),
    $window.FindName("PageNuke"),
    $window.FindName("PageTools")
  )
  $navButtons = @(
    $window.FindName("NavGeneral"),
    $window.FindName("NavReview"),
    $window.FindName("NavNuke"),
    $window.FindName("NavTools")
  )
  $navNormal = $window.Resources["NavBtn"]
  $navActive = $window.Resources["NavBtnActive"]

  function Set-CtrackNavPage {
    param([int]$Index)
    for ($i = 0; $i -lt $pages.Count; $i++) {
      $pages[$i].Visibility = if ($i -eq $Index) { "Visible" } else { "Collapsed" }
      $navButtons[$i].Style = if ($i -eq $Index) { $navActive } else { $navNormal }
    }
  }

  for ($n = 0; $n -lt $navButtons.Count; $n++) {
    $navIdx = $n
    $navButtons[$n].Add_Click({ Set-CtrackNavPage -Index $navIdx })
  }

  $txtWeb = $window.FindName("TxtWebUrl")
  $chkLogin = $window.FindName("ChkLogin")
  $chkNotify = $window.FindName("ChkNotify")
  $txtEngineStatus = $window.FindName("TxtEngineStatus")
  $statusBackend = $window.FindName("StatusBackend")
  $statusNukeCount = $window.FindName("StatusNukeCount")

  $cmbMode = $window.FindName("CmbTranscodeMode")
  $lstOrder = $window.FindName("LstOrder")
  $txtActive = $window.FindName("TxtActiveBackend")
  $cmbPreset = $window.FindName("CmbMp4Preset")
  $txtW = $window.FindName("TxtMp4Width")
  $txtH = $window.FindName("TxtMp4Height")
  $txtMp4Hint = $window.FindName("TxtMp4Hint")

  $cmbNuke = $window.FindName("CmbNuke")
  $chkInteractive = $window.FindName("ChkInteractive")
  $chkSafe = $window.FindName("ChkSafe")
  $txtTemplate = $window.FindName("TxtTemplate")
  $listTools = $window.FindName("ListTools")
  $txtLastScan = $window.FindName("TxtLastScan")

  $presetMap = [ordered]@{
    "1080p HD (1920 x 1080)" = "1080p"
    "720p HD (1280 x 720)"   = "720p"
    "4K UHD (3840 x 2160)"   = "4k"
    "Custom"                 = "custom"
  }
  $presetDims = @{
    "1080p" = @(1920, 1080)
    "720p"  = @(1280, 720)
    "4k"    = @(3840, 2160)
  }

  function Update-Mp4PresetUi {
    $key = $null
    foreach ($k in $presetMap.Keys) {
      if ($presetMap[$k] -eq $script:SelectedPreset) { $key = $k; break }
    }
    if ($key) { $cmbPreset.SelectedItem = $key }
    $custom = ($script:SelectedPreset -eq "custom")
    $txtW.IsEnabled = $custom
    $txtH.IsEnabled = $custom
    if (!$custom -and $presetDims.ContainsKey($script:SelectedPreset)) {
      $d = $presetDims[$script:SelectedPreset]
      $txtW.Text = [string]$d[0]
      $txtH.Text = [string]$d[1]
    }
    $txtMp4Hint.Text = "Review MP4s are scaled to fit this resolution (Nuke Reformat, OIIO --fit, FFmpeg scale)."
  }

  function Fill-ToolsGrid {
    param($Runtime)
    $rows = @()
    if ($Runtime -and $Runtime.tools) {
      $map = @(
        @("Python", $Runtime.tools.python),
        @("FFmpeg", $Runtime.tools.ffmpeg),
        @("OpenImageIO", $Runtime.tools.oiiotool),
        @("OCIO", $Runtime.tools.ocio),
        @("Nuke", $Runtime.tools.nuke),
        @("Template", $Runtime.tools.nukeTemplate)
      )
      foreach ($m in $map) {
        $t = $m[1]
        $ok = $t -and $t.available
        $rows += [PSCustomObject]@{
          Tool   = $m[0]
          Status = if ($ok) { "Ready" } else { "Missing" }
          Path   = if ($t.path) { $t.path } else { "" }
        }
      }
    }
    $listTools.ItemsSource = $rows
  }

  function Load-BundleIntoUi {
    param($B)
    $txtWeb.Text = $B.tray.webUrl
    $chkLogin.IsChecked = [bool]$B.tray.launchAtLogin
    $chkNotify.IsChecked = ($B.tray.notifyOnMissingTools -ne $false)
    $setup = if ($B.setupComplete) { "Ready" } else { "Needs configuration" }
    $txtEngineStatus.Text = "API: http://127.0.0.1:7777`nSetup: $setup`nConfig: $($B.paths.userDataDir)"
    $active = if ($B.runtime.activeExrBackend) { $B.runtime.activeExrBackend } else { "none" }
    $statusBackend.Text = "EXR backend: $active"
    $nukeN = @($B.engine.nukeInstallations).Count
    $statusNukeCount.Text = "Nuke installs: $nukeN"
    $txtActive.Text = "Active backend: $active"
    [void]$cmbMode.Items.Clear()
    foreach ($m in @("auto", "nuke", "oiio", "ffmpeg")) { [void]$cmbMode.Items.Add($m) }
    $cmbMode.SelectedItem = $B.engine.transcodeMode
    $lstOrder.Items.Clear()
    foreach ($o in $B.engine.exrTranscodeOrder) { [void]$lstOrder.Items.Add($o) }
    $script:SelectedPreset = $B.engine.reviewMp4Preset
    if (!$script:SelectedPreset) { $script:SelectedPreset = "1080p" }
    [void]$cmbPreset.Items.Clear()
    foreach ($k in $presetMap.Keys) { [void]$cmbPreset.Items.Add($k) }
    $txtW.Text = [string]$B.engine.reviewMp4Width
    $txtH.Text = [string]$B.engine.reviewMp4Height
    Update-Mp4PresetUi
    $cmbNuke.Items.Clear()
    if (@($B.engine.nukeInstallations).Count -gt 0) {
      $cmbNuke.IsEnabled = $true
      $sel = 0
      $i = 0
      foreach ($n in $B.engine.nukeInstallations) {
        [void]$cmbNuke.Items.Add($n.label)
        if ($n.exePath -eq $B.engine.preferredNukeExe) { $sel = $i }
        $i++
      }
      $cmbNuke.SelectedIndex = $sel
    } else {
      [void]$cmbNuke.Items.Add("(No Nuke found - rescan on Tools tab)")
      $cmbNuke.SelectedIndex = 0
      $cmbNuke.IsEnabled = $false
    }
    $chkInteractive.IsChecked = ($B.engine.nukeInteractive -ne $false)
    $chkSafe.IsChecked = ($B.engine.nukeSafeMode -ne $false)
    $tpl = if ($B.engine.sampleNkTemplate) { $B.engine.sampleNkTemplate } else { "(not found)" }
    $txtTemplate.Text = $tpl
    Fill-ToolsGrid -Runtime $B.runtime
    $scan = if ($B.engine.lastToolScanAt) { $B.engine.lastToolScanAt } else { "never" }
    $txtLastScan.Text = "Last scan: $scan"
  }

  Load-BundleIntoUi -B $bundle

  $cmbPreset.Add_SelectionChanged({
    $label = [string]$cmbPreset.SelectedItem
    if ($presetMap.Contains($label)) {
      $script:SelectedPreset = $presetMap[$label]
      Update-Mp4PresetUi
    }
  })

  $window.FindName("BtnOrderUp").Add_Click({
    $i = $lstOrder.SelectedIndex
    if ($i -gt 0) {
      $item = $lstOrder.Items[$i]
      $lstOrder.Items.RemoveAt($i)
      $lstOrder.Items.Insert($i - 1, $item)
      $lstOrder.SelectedIndex = $i - 1
    }
  })
  $window.FindName("BtnOrderDown").Add_Click({
    $i = $lstOrder.SelectedIndex
    if ($i -ge 0 -and $i -lt ($lstOrder.Items.Count - 1)) {
      $item = $lstOrder.Items[$i]
      $lstOrder.Items.RemoveAt($i)
      $lstOrder.Items.Insert($i + 1, $item)
      $lstOrder.SelectedIndex = $i + 1
    }
  })

  $window.FindName("BtnOpenConfig").Add_Click({
    Start-Process "explorer.exe" $script:Bundle.paths.userDataDir
  })
  $window.FindName("BtnOpenSetup").Add_Click({
    $url = $txtWeb.Text.Trim().TrimEnd("/") + "/setup"
    Start-Process $url
  })

  $window.FindName("BtnBrowseNuke").Add_Click({
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Filter = "Nuke|Nuke*.exe|Executables|*.exe"
    $dlg.Title = "Select Nuke executable"
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      $script:CustomNukeExe = $dlg.FileName
      [void]$cmbNuke.Items.Add("(Custom) " + [IO.Path]::GetFileName($dlg.FileName))
      $cmbNuke.SelectedIndex = $cmbNuke.Items.Count - 1
      $cmbNuke.IsEnabled = $true
    }
  })

  $window.FindName("BtnRescan").Add_Click({
    try {
      Invoke-RestMethod -Uri "$script:BaseUrl/api/engine/rescan" -Method POST -TimeoutSec 45 | Out-Null
      $fresh = Get-CtrackSettingsBundle -BaseUrl $script:BaseUrl
      if ($fresh) {
        $script:Bundle = $fresh
        Load-BundleIntoUi -B $fresh
      }
      [System.Windows.Forms.MessageBox]::Show("Rescan complete.", "CTrack Engine") | Out-Null
    } catch {
      [System.Windows.Forms.MessageBox]::Show("Rescan failed: $_", "CTrack Engine") | Out-Null
    }
  })

  $script:saved = $false
  $window.FindName("BtnSave").Add_Click({
    try {
      $orderList = @()
      foreach ($item in $lstOrder.Items) { $orderList += [string]$item }
      $preferredNuke = $null
      if ($script:CustomNukeExe) {
        $preferredNuke = $script:CustomNukeExe
      } elseif ($cmbNuke.IsEnabled -and $cmbNuke.SelectedIndex -ge 0 -and @($script:Bundle.engine.nukeInstallations).Count -gt 0) {
        $preferredNuke = $script:Bundle.engine.nukeInstallations[$cmbNuke.SelectedIndex].exePath
      }
      $enginePatch = @{
        preferredNukeExe     = $preferredNuke
        exrTranscodeOrder    = $orderList
        nukeInteractive      = [bool]$chkInteractive.IsChecked
        nukeSafeMode         = [bool]$chkSafe.IsChecked
        transcodeMode        = [string]$cmbMode.SelectedItem
        reviewMp4Preset      = $script:SelectedPreset
        reviewMp4Width       = [int]$txtW.Text
        reviewMp4Height      = [int]$txtH.Text
      }
      $trayPatch = @{
        webUrl               = $txtWeb.Text.Trim()
        launchAtLogin        = [bool]$chkLogin.IsChecked
        notifyOnMissingTools = [bool]$chkNotify.IsChecked
      }
      $result = Save-CtrackSettingsBundle -EnginePatch $enginePatch -TrayPatch $trayPatch -BaseUrl $script:BaseUrl
      Set-CtrackLaunchAtLogin -Enabled ([bool]$chkLogin.IsChecked) -TrayBatPath $TrayBatPath
      if ($OnApplied) { & $OnApplied $result $txtWeb.Text.Trim() }
      $script:saved = $true
      $window.DialogResult = $true
      $window.Close()
    } catch {
      [System.Windows.Forms.MessageBox]::Show("Save failed: $_", "CTrack Engine") | Out-Null
    }
  })

  $window.FindName("BtnCancel").Add_Click({
    $window.DialogResult = $false
    $window.Close()
  })

  [void]$window.ShowDialog()
  return [bool]$script:saved
}
