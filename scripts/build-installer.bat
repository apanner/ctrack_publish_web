@echo off
setlocal
cd /d "%~dp0.."

echo [ctrack] Building release folder...
call scripts\build-release.bat /nopause
if errorlevel 1 exit /b 1

echo [ctrack] Embedding portable Node.js...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0embed-node.ps1"
if errorlevel 1 exit /b 1

set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if "%ISCC%"=="" (
  echo [ctrack] Inno Setup 6 not found — skipping installer. Install from https://jrsoftware.org/isdl.php
  echo [ctrack] Release payload is ready under release\
  exit /b 0
)

echo [ctrack] Normalizing installer wizard images for Inno (164:314 + square)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\installer\branding\normalize-wizard-images.ps1"
if errorlevel 1 exit /b 1

echo [ctrack] Compiling installer...
"%ISCC%" "%~dp0..\installer\CTrackEngine.iss"
if errorlevel 1 exit /b 1

echo [ctrack] Done: installer\output\CTrackPublishEngine-Setup.exe
exit /b 0
