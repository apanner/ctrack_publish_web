@echo off
setlocal
cd /d "%~dp0.."

set "NO_PAUSE="
set "INSTALLER_BUILD="
for %%A in (%*) do (
  if /i "%%~A"=="/nopause" set "NO_PAUSE=1"
  if /i "%%~A"=="/bundle-env" set "CTRACK_BUNDLE_ENV=1"
  if /i "%%~A"=="/installer" set "INSTALLER_BUILD=1"
)
if "%CTRACK_BUNDLE_ENV_FILE%"=="" set "CTRACK_BUNDLE_ENV_FILE=engine\.env"

echo [ctrack] Syncing version from version.json...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-version.ps1"
if errorlevel 1 exit /b 1

echo [ctrack] npm install (workspace, skip native rebuild if engine is running)...
call npm install --ignore-scripts
if errorlevel 1 exit /b 1

echo [ctrack] Provisioning engine runtime + GUI Python...
if /i not "%INSTALLER_BUILD%"=="1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-engine-runtime.ps1" -TargetRoot engine
  if errorlevel 1 exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0provision-gui-python.ps1" -TargetRoot engine
if errorlevel 1 exit /b 1

echo [ctrack] Building engine...
call npm run build -w engine
if errorlevel 1 exit /b 1

echo [ctrack] Provisioning embedded Python + GUI for release folder...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0provision-gui-python.ps1" -TargetRoot engine
if errorlevel 1 exit /b 1

echo [ctrack] Provisioning app icons...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0provision-app-icons.ps1"
if errorlevel 1 exit /b 1

echo [ctrack] Building web...
if /i not "%INSTALLER_BUILD%"=="1" (
  call npm run build -w web
  if errorlevel 1 exit /b 1
) else (
  echo [ctrack] Skipping web build for installer package ^(hosted Vercel UI^).
)

set "OUT=%~dp0..\release"
if not exist "%OUT%" mkdir "%OUT%"

echo [ctrack] Staging release\ ...
if exist "%OUT%\engine" rmdir /S /Q "%OUT%\engine"
if exist "%OUT%\web" rmdir /S /Q "%OUT%\web"
mkdir "%OUT%\engine" 2>nul
if /i not "%INSTALLER_BUILD%"=="1" mkdir "%OUT%\web" 2>nul
xcopy /E /I /Y "engine\dist" "%OUT%\engine\dist\" >nul
xcopy /E /I /Y "engine\python" "%OUT%\engine\python\" >nul
if /i not "%INSTALLER_BUILD%"=="1" (
  if exist "web\dist" xcopy /E /I /Y "web\dist" "%OUT%\web\dist\" >nul
)
copy /Y "engine\.env.example" "%OUT%\engine\.env.example" >nul 2>nul
copy /Y "web\.env.example" "%OUT%\web\.env.example" >nul 2>nul
copy /Y "engine\package.json" "%OUT%\engine\package.json" >nul
copy /Y "%~dp0start-engine-release.bat" "%OUT%\start-engine.bat" >nul
copy /Y "%~dp0start-engine-release-hidden.vbs" "%OUT%\start-engine-hidden.vbs" >nul
copy /Y "%~dp0start-engine-tray.bat" "%OUT%\start-engine-tray.bat" >nul
copy /Y "%~dp0start-engine-tray.vbs" "%OUT%\start-engine-tray.vbs" >nul
echo [ctrack] Skipping legacy WPF tray scripts from release package.
copy /Y "%~dp0open-tray-settings.bat" "%OUT%\open-tray-settings.bat" >nul
copy /Y "%~dp0open-tray-settings.vbs" "%OUT%\open-tray-settings.vbs" >nul
copy /Y "%~dp0open-tray-settings.ps1" "%OUT%\open-tray-settings.ps1" >nul
if not exist "%OUT%\scripts" mkdir "%OUT%\scripts"
copy /Y "%~dp0download-media-pack.ps1" "%OUT%\scripts\download-media-pack.ps1" >nul
copy /Y "%~dp0ensure-engine-runtime.ps1" "%OUT%\scripts\ensure-engine-runtime.ps1" >nul
if exist "%~dp0..\release\ctrack-engine.exe" copy /Y "%~dp0..\release\ctrack-engine.exe" "%OUT%\ctrack-engine.exe" >nul
if exist "engine-go\..\release\ctrack-engine.exe" copy /Y "engine-go\..\release\ctrack-engine.exe" "%OUT%\ctrack-engine.exe" >nul
if not exist "%OUT%\engine\assets" mkdir "%OUT%\engine\assets"
xcopy /E /I /Y "engine\assets" "%OUT%\engine\assets\" >nul 2>nul
copy /Y "%~dp0..\installer\ENGINE-INSTALL.txt" "%OUT%\ENGINE-INSTALL.txt" >nul 2>nul

if /i "%CTRACK_BUNDLE_ENV%"=="1" (
  if not exist "%CTRACK_BUNDLE_ENV_FILE%" (
    echo [ctrack] ERROR: CTRACK_BUNDLE_ENV=1 but "%CTRACK_BUNDLE_ENV_FILE%" was not found.
    echo [ctrack] Set CTRACK_BUNDLE_ENV_FILE to a valid .env path, or run without /bundle-env.
    exit /b 1
  )
  echo [ctrack] Bundling engine env: %CTRACK_BUNDLE_ENV_FILE%
  copy /Y "%CTRACK_BUNDLE_ENV_FILE%" "%OUT%\engine\.env" >nul
) else (
  echo [ctrack] Not bundling secrets. Use /bundle-env to include engine\.env in a facility installer.
)

echo [ctrack] npm install production deps in release\engine ...
pushd "%OUT%\engine"
call npm install --omit=dev --ignore-scripts
if errorlevel 1 (
  popd
  exit /b 1
)
if exist "..\..\node_modules\better-sqlite3" (
  echo [ctrack] Copying prebuilt better-sqlite3 from workspace node_modules...
  if not exist "node_modules" mkdir "node_modules"
  xcopy /E /I /Y "..\..\node_modules\better-sqlite3" "node_modules\better-sqlite3\" >nul
) else if exist "..\..\engine\node_modules\better-sqlite3" (
  echo [ctrack] Copying prebuilt better-sqlite3 from engine\node_modules...
  if not exist "node_modules" mkdir "node_modules"
  xcopy /E /I /Y "..\..\engine\node_modules\better-sqlite3" "node_modules\better-sqlite3\" >nul
) else (
  echo [ctrack] ERROR: better-sqlite3 not found. Run npm install at repo root before release build.
  popd
  exit /b 1
)
popd

echo [ctrack] Embedding portable Python runtime...
if /i "%INSTALLER_BUILD%"=="1" (
  echo [ctrack] Installer build: bundling Python + FFmpeg/OIIO/OCIO media runtime...
  set "CTRACK_SKIP_POSTINSTALL_RUNTIME="
  if exist "engine\runtime\python\python.exe" (
    if not exist "%OUT%\engine\runtime" mkdir "%OUT%\engine\runtime"
    xcopy /E /I /Y "engine\runtime\python" "%OUT%\engine\runtime\python\" >nul
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-engine-runtime.ps1" -TargetRoot "%OUT%\engine" -Provision
    if errorlevel 1 exit /b 1
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-python-runtime.ps1"
    if errorlevel 1 exit /b 1
  )
) else if exist "engine\runtime\python\python.exe" (
  echo [ctrack] Reusing dev engine runtime in release\engine\runtime ...
  if not exist "%OUT%\engine\runtime" mkdir "%OUT%\engine\runtime"
  xcopy /E /I /Y "engine\runtime" "%OUT%\engine\runtime\" >nul
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-engine-runtime.ps1" -TargetRoot "%OUT%\engine"
  if errorlevel 1 exit /b 1
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-python-runtime.ps1"
  if errorlevel 1 exit /b 1
)

echo.
echo [ctrack] Done: %OUT%
echo   Read ENGINE-INSTALL.txt for .env paths and port 7777.
echo   Runtime included: Python, FFmpeg, OpenImageIO, OCIO, Node deps.
echo   Start with tray: start-engine-tray.bat  ^(or start-engine.bat for console^)
if /i "%CTRACK_BUNDLE_ENV%"=="1" echo   Facility env bundled into release\engine\.env.
echo   Optional: embed portable Node — powershell -ExecutionPolicy Bypass -File scripts\embed-node.ps1
echo   Optional: build installer — scripts\build-installer.bat ^(requires Inno Setup 6^)
echo   Host %%OUT%%\web\dist with any static server ^(e.g. npx serve web\dist^)
echo.
if not defined NO_PAUSE pause
