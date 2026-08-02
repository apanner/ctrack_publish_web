@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "PAYLOAD_DIR=%SCRIPT_DIR%build\payload"
set "OUTPUT_DIR=%SCRIPT_DIR%output"
set "ISS_PATH=%SCRIPT_DIR%CTrackNuke.iss"

echo.
echo CTrack Nuke installer build
echo Project: %PROJECT_DIR%
echo.

if exist "%PAYLOAD_DIR%" (
  rmdir /s /q "%PAYLOAD_DIR%"
)
mkdir "%PAYLOAD_DIR%" >nul 2>&1
if errorlevel 1 (
  echo Failed to create payload directory:
  echo   %PAYLOAD_DIR%
  exit /b 1
)

if not exist "%OUTPUT_DIR%" (
  mkdir "%OUTPUT_DIR%" >nul 2>&1
)

echo Copying plugin files to payload...
robocopy "%PROJECT_DIR%" "%PAYLOAD_DIR%" /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP /XD ".git" "__pycache__" "installer" "install" /XF "*.pyc"
set "ROBOCOPY_EXIT=%ERRORLEVEL%"
if %ROBOCOPY_EXIT% GEQ 8 (
  echo File copy failed. Robocopy exit code: %ROBOCOPY_EXIT%
  exit /b 1
)

set "ISCC_EXE="
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
  set "ISCC_EXE=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
) else if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
  set "ISCC_EXE=C:\Program Files\Inno Setup 6\ISCC.exe"
) else (
  for %%I in (ISCC.exe) do set "ISCC_EXE=%%~$PATH:I"
)

if "%ISCC_EXE%"=="" (
  echo.
  echo ISCC.exe not found. Payload prepared successfully:
  echo   %PAYLOAD_DIR%
  echo.
  echo Install Inno Setup 6, then compile manually:
  echo   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" "%ISS_PATH%"
  exit /b 0
)

echo Running Inno Setup compiler:
echo   %ISCC_EXE%
"%ISCC_EXE%" "%ISS_PATH%"
if errorlevel 1 (
  echo Inno Setup compilation failed.
  exit /b 1
)

echo.
echo Installer built successfully.
echo Output folder:
echo   %OUTPUT_DIR%
exit /b 0
