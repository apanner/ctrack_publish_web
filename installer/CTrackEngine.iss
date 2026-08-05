; Inno Setup 6 — CTrack Publish Engine (VFX / post-production branding)
; Wizard artwork: .\branding\ (240x459 sidebar + 147x147 header — HiDPI-safe ratios per Inno docs)
; Compile: "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\CTrackEngine.iss
; If setup shows "bitmap is not valid", run branding\normalize-wizard-images.ps1 (outputs 24-bit BMP; PNG sources alone often fail at runtime).

#define MyAppName "CTrack Publish Engine"
#ifndef MyAppVersion
#define MyAppVersion "0.1.0"
#endif
#define MyAppPublisher "CTrack"
#define MyTrayVbs "start-engine-tray.vbs"

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

SetupIconFile=branding\app-icon.ico
UninstallDisplayIcon={app}\engine\assets\ctrack-tray.ico

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
english.WelcomeLabel2=Click Next to continue.%n%nThe core installer includes Node and portable Python. FFmpeg, OpenImageIO, and OCIO download on first transcode, or select the optional full media pack for offline sites.

english.FinishedLabel=Setup has installed [name] on this workstation.%n%nFrom the Start menu, run Start CTrack Engine to launch the system tray host (engine API on 127.0.0.1:7777). Sign in opens your browser to pair this workstation. Then open the hosted CTrack Publish web app.

[Files]
Source: "..\release\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut for CTrack Publish Engine"; GroupDescription: "Additional shortcuts:"; Flags: unchecked
Name: "firewall"; Description: "Re-apply Windows Firewall loopback rule for port 7777 (usually added automatically)"; GroupDescription: "Network:"; Flags: unchecked
Name: "fullmedia"; Description: "Include FFmpeg, OpenImageIO, and OCIO in this install (offline / air-gapped sites)"; GroupDescription: "Media runtime:"; Flags: unchecked

[Run]
Filename: "{cmd}"; Parameters: "/C netsh advfirewall firewall add rule name=""CTrack Engine API (loopback 7777)"" dir=in action=allow protocol=TCP localip=127.0.0.1 localport=7777 profile=private,domain"; Flags: runhidden
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\download-media-pack.ps1"" -TargetRoot ""{app}\engine"""; Flags: runhidden; Tasks: fullmedia
Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\{#MyTrayVbs}"""; Description: "Start CTrack Engine in the system tray"; Flags: postinstall nowait skipifsilent

[Icons]
Name: "{group}\Start CTrack Engine"; Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\{#MyTrayVbs}"""; WorkingDir: "{app}"; IconFilename: "{app}\engine\assets\ctrack-tray.ico"
Name: "{group}\Start CTrack Engine (native)"; Filename: "{app}\ctrack-engine.exe"; WorkingDir: "{app}"; IconFilename: "{app}\engine\assets\ctrack-tray.ico"; Check: FileExists(ExpandConstant('{app}\ctrack-engine.exe'))
Name: "{group}\Start Engine (console)"; Filename: "{app}\start-engine.bat"; WorkingDir: "{app}"; IconFilename: "{app}\engine\assets\ctrack-tray.ico"
Name: "{group}\Engine Settings"; Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\open-tray-settings.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\engine\assets\ctrack-tray.ico"
Name: "{group}\Open Hosted Web UI"; Filename: "https://ctrackpublishweb.vercel.app/"; IconFilename: "{app}\engine\assets\ctrack-tray.ico"
Name: "{group}\Open engine folder"; Filename: "{win}\explorer.exe"; Parameters: """{app}\engine"""; IconFilename: "{app}\engine\assets\ctrack-tray.ico"
Name: "{autodesktop}\CTrack Publish Engine"; Filename: "{sys}\wscript.exe"; Parameters: "//nologo ""{app}\{#MyTrayVbs}"""; WorkingDir: "{app}"; IconFilename: "{app}\engine\assets\ctrack-tray.ico"; Tasks: desktopicon
