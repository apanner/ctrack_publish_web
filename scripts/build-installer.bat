@echo off
setlocal
cd /d "%~dp0.."

for %%A in (%*) do (
  if /i "%%~A"=="/bundle-env" set "CTRACK_BUNDLE_ENV=1"
)

echo [ctrack] Building release folder...
call scripts\build-release.bat /nopause /installer
if errorlevel 1 exit /b 1

echo [ctrack] Embedding portable Node.js...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0embed-node.ps1"
if errorlevel 1 exit /b 1

echo [ctrack] Rebuilding native modules for embedded Node...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rebuild-release-native.ps1"
if errorlevel 1 exit /b 1

if exist "%ProgramFiles%\Go\bin\go.exe" (
  echo [ctrack] Building Go tray binary ^(ctrack-engine.exe^)...
  call "%~dp0build-go-engine.bat"
)

set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if "%ISCC%"=="" (
  echo [ctrack] Inno Setup 6 not found — skipping installer. Install from https://jrsoftware.org/isdl.php
  echo [ctrack] Release payload is ready under release\
  exit /b 0
)

echo [ctrack] Normalizing installer wizard images for Inno (164:314 + square)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0provision-app-icons.ps1"
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\installer\branding\normalize-wizard-images.ps1"
if errorlevel 1 exit /b 1

echo [ctrack] Compiling installer...
set "ENGINE_VER="
for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "(Get-Content '%~dp0..\version.json' -Raw | ConvertFrom-Json).engine"`) do set "ENGINE_VER=%%V"
if "%ENGINE_VER%"=="" (
  echo [ctrack] Could not read engine version from version.json
  exit /b 1
)

echo [ctrack] Signing bundled runtimes (optional)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sign-release-artifacts.ps1"
if errorlevel 1 exit /b 1

"%ISCC%" /DMyAppVersion=%ENGINE_VER% "%~dp0..\installer\CTrackEngine.iss"
if errorlevel 1 exit /b 1

echo [ctrack] Signing installer output (optional)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sign-windows-binary.ps1" -Path "%~dp0..\installer\output\CTrackPublishEngine-Setup.exe"
if errorlevel 1 exit /b 1

echo [ctrack] Done: installer\output\CTrackPublishEngine-Setup.exe
exit /b 0
