; Inno Setup 6 — CTrack Nuke Plugin
; Compile: "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\CTrackNuke.iss

#define MyAppName "CTrack Nuke Plugin"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "CTrack"

[Setup]
AppId={{3A0533F2-091B-462C-9770-BE1F173A7BBF}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppCopyright=Copyright (C) 2026 {#MyAppPublisher}
DefaultDirName={userpf}\.nuke\ctrack
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
DisableProgramGroupPage=yes

OutputDir=output
OutputBaseFilename=CTrackNuke-Setup
Compression=lzma2/max
SolidCompression=yes

WizardStyle=modern

PrivilegesRequired=lowest
SetupMutex=Global\CTrackNuke_Setup_{#MyAppVersion}

VersionInfoVersion={#MyAppVersion}.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
VersionInfoTextVersion={#MyAppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
english.WelcomeLabel1=Welcome to the [name] Setup Wizard.%n%nThis installs the CTrack plugin package for Foundry Nuke so the workstation can connect to the local CTrack engine and expose CTrack menu actions inside Nuke.
english.WelcomeLabel2=Click Next to continue.%n%nDefault install target is under your user profile, and you can choose to update Nuke init.py automatically.
english.FinishedLabel=Setup has installed [name].%n%nUse the Start menu shortcut to open README instructions and confirm init.py contains the pluginAddPath entry before launching Nuke.

[Files]
Source: "build\payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Tasks]
Name: "appendinit"; Description: "Append nuke.pluginAddPath to %USERPROFILE%\.nuke\init.py (creates backup)"; Flags: unchecked

[Icons]
Name: "{group}\CTrack Nuke README"; Filename: "{app}\README.md"

[Code]
function GetNukeInitPath(): string;
begin
  Result := ExpandConstant('{userprofile}\.nuke\init.py');
end;

function EndsWithCrlf(const Value: string): Boolean;
begin
  Result := (Length(Value) >= 2) and (Copy(Value, Length(Value) - 1, 2) = #13#10);
end;

procedure AppendPluginPathToInit();
var
  InitPath: string;
  InitDirectory: string;
  BackupPath: string;
  ExistingContent: AnsiString;
  UpdatedContent: AnsiString;
  PluginPath: string;
  PluginAddPathLine: AnsiString;
  AppendBlock: AnsiString;
begin
  InitPath := GetNukeInitPath();
  InitDirectory := ExtractFileDir(InitPath);
  PluginPath := ExpandConstant('{app}');
  PluginAddPathLine := 'nuke.pluginAddPath(r''' + PluginPath + ''')';

  if (not DirExists(InitDirectory)) and (not ForceDirectories(InitDirectory)) then
  begin
    MsgBox('Could not create Nuke directory:' + #13#10 + InitDirectory, mbError, MB_OK);
    Exit;
  end;

  if FileExists(InitPath) then
  begin
    if not LoadStringFromFile(InitPath, ExistingContent) then
    begin
      MsgBox('Could not read init.py:' + #13#10 + InitPath, mbError, MB_OK);
      Exit;
    end;
    BackupPath := InitPath + '.bak.' + GetDateTimeString('yyyymmddhhnnss', '', '');
    if not SaveStringToFile(BackupPath, ExistingContent, False) then
    begin
      MsgBox('Could not create backup file:' + #13#10 + BackupPath, mbError, MB_OK);
      Exit;
    end;
  end
  else
  begin
    ExistingContent := '';
  end;

  if Pos(PluginAddPathLine, ExistingContent) > 0 then
  begin
    Log('CTrack plugin path already present in init.py');
    Exit;
  end;

  AppendBlock :=
    '# Added by CTrack installer' + #13#10 +
    'try:' + #13#10 +
    '    import nuke' + #13#10 +
    '    ' + PluginAddPathLine + #13#10 +
    'except Exception:' + #13#10 +
    '    pass' + #13#10;

  UpdatedContent := ExistingContent;
  if (UpdatedContent <> '') and (not EndsWithCrlf(UpdatedContent)) then
  begin
    UpdatedContent := UpdatedContent + #13#10;
  end;
  UpdatedContent := UpdatedContent + AppendBlock;

  if not SaveStringToFile(InitPath, UpdatedContent, False) then
  begin
    MsgBox('Could not update init.py:' + #13#10 + InitPath, mbError, MB_OK);
    Exit;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('appendinit') then
  begin
    AppendPluginPathToInit();
  end;
end;
