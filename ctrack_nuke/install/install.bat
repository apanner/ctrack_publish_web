@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "SOURCE_DIR=%SCRIPT_DIR%.."
set "DEFAULT_TARGET=%USERPROFILE%\.nuke\ctrack"

echo.
echo CTrack Nuke Plugin Installer
echo Source: %SOURCE_DIR%
echo.
echo Default install path:
echo   %DEFAULT_TARGET%
echo.

set /p "TARGET_DIR=Install path (press Enter for default): "
if "%TARGET_DIR%"=="" set "TARGET_DIR=%DEFAULT_TARGET%"

if not exist "%TARGET_DIR%" (
  mkdir "%TARGET_DIR%" >nul 2>&1
  if errorlevel 1 (
    echo Failed to create target directory:
    echo   %TARGET_DIR%
    exit /b 1
  )
)

echo.
echo Copying plugin files...
robocopy "%SOURCE_DIR%" "%TARGET_DIR%" /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XD ".git" "__pycache__" "install" >nul
set "ROBOCOPY_EXIT=%ERRORLEVEL%"
if %ROBOCOPY_EXIT% GEQ 8 (
  echo Copy failed. Robocopy exit code: %ROBOCOPY_EXIT%
  exit /b 1
)

copy /Y "%SCRIPT_DIR%README.md" "%TARGET_DIR%\install_README.md" >nul

echo.
echo Installed CTrack plugin to:
echo   %TARGET_DIR%
echo.
echo Next steps:
echo 1) Open or create: %USERPROFILE%\.nuke\init.py
echo 2) Add this line once:
echo    nuke.pluginAddPath(r"%TARGET_DIR%")
echo 3) Restart Nuke.
echo.
echo Done.
exit /b 0
