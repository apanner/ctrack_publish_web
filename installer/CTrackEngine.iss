; Inno Setup 6 — CTrack Publish Engine (VFX / post-production branding)
; Wizard artwork: .\branding\ (240x459 sidebar + 147x147 header — HiDPI-safe ratios per Inno docs)
; Compile: "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\CTrackEngine.iss
; If setup shows "bitmap is not valid", run branding\normalize-wizard-images.ps1 (outputs 24-bit BMP; PNG sources alone often fail at runtime).

#define MyAppName "CTrack Publish Engine"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "CTrack"
#define MyAppExeName "start-engine.bat"

[Setup]
AppId={{A8E9F4C3-6B2D-4E1F-9C0D-AABBCCDDEEFF}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppCopyright=Copyright (C) 2026 {#MyAppPublisher}
DefaultDirName={autopf}\CTrackPublishEngine
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
DisableProgramGroupPage=yes

OutputDir=..\installer\output
OutputBaseFilename=CTrackPublishEngine-Setup
Compression=lzma2/max
SolidCompression=yes

WizardStyle=modern
; 24-bit BMP (see branding\normalize-wizard-images.ps1) — PNGs often trigger "bitmap is not valid" at runtime
WizardImageFile=branding\wizard-large.bmp
WizardSmallImageFile=branding\wizard-small.bmp
WizardImageStretch=yes

ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
SetupMutex=Global\CTrackPublishEngine_Setup_{#MyAppVersion}

VersionInfoVersion={#MyAppVersion}.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
VersionInfoTextVersion={#MyAppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
; Professional VFX pipeline tone — matches CTrack web shell (dark / teal accents)
english.WelcomeLabel1=Welcome to the [name] Setup Wizard.%n%nThis installs the local publish engine for CTrack: transcoding, staging, job queue, object storage upload, and pipeline hooks aligned with review and delivery workflows common in VFX and episodic production.
english.WelcomeLabel2=Click Next to continue.%n%nAfter install, copy your facility secrets into engine\.env (see engine\.env.example under the install folder). Close other transcode or watch-folder tools if your pipeline policy requires a quiet install window.

english.FinishedLabel=Setup has installed [name] on this workstation.%n%nFrom the Start menu, run Start CTrack Engine when you are ready to serve the API on 127.0.0.1:7777. Host the static web build under web\dist as documented, then open your browser to the configured origin (often localhost during facility tests).

[Files]
Source: "..\release\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Start CTrack Engine"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\Open Web UI (localhost)"; Filename: "http://localhost:5173/"
Name: "{group}\Open engine folder"; Filename: "{win}\explorer.exe"; Parameters: """{app}\engine"""
