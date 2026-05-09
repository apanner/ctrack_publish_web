@echo off
setlocal
cd /d "%~dp0.."

echo [ctrack] npm install (workspace)...
call npm install
if errorlevel 1 exit /b 1

echo [ctrack] Building engine...
call npm run build -w engine
if errorlevel 1 exit /b 1

echo [ctrack] Building web...
call npm run build -w web
if errorlevel 1 exit /b 1

set "OUT=%~dp0..\release"
if not exist "%OUT%" mkdir "%OUT%"

echo [ctrack] Staging release\ ...
if exist "%OUT%\engine" rmdir /S /Q "%OUT%\engine"
if exist "%OUT%\web" rmdir /S /Q "%OUT%\web"
mkdir "%OUT%\engine" 2>nul
mkdir "%OUT%\web" 2>nul
xcopy /E /I /Y "engine\dist" "%OUT%\engine\dist\" >nul
xcopy /E /I /Y "engine\python" "%OUT%\engine\python\" >nul
xcopy /E /I /Y "web\dist" "%OUT%\web\dist\" >nul
copy /Y "engine\.env.example" "%OUT%\engine\.env.example" >nul 2>nul
copy /Y "web\.env.example" "%OUT%\web\.env.example" >nul 2>nul
copy /Y "engine\package.json" "%OUT%\engine\package.json" >nul
copy /Y "%~dp0start-engine-release.bat" "%OUT%\start-engine.bat" >nul
copy /Y "%~dp0start-engine-release-hidden.vbs" "%OUT%\start-engine-hidden.vbs" >nul
copy /Y "%~dp0..\installer\ENGINE-INSTALL.txt" "%OUT%\ENGINE-INSTALL.txt" >nul 2>nul

echo [ctrack] npm install production deps in release\engine ...
pushd "%OUT%\engine"
call npm install --omit=dev
if errorlevel 1 (
  popd
  exit /b 1
)
popd

echo.
echo [ctrack] Done: %OUT%
echo   Read ENGINE-INSTALL.txt for .env paths and port 7777.
echo   Copy your .env into %%OUT%%\engine\.env
echo   Optional: embed portable Node — powershell -ExecutionPolicy Bypass -File scripts\embed-node.ps1
echo   Optional: build installer — scripts\build-installer.bat ^(requires Inno Setup 6^)
echo   Host %%OUT%%\web\dist with any static server ^(e.g. npx serve web\dist^)
echo.
if /i not "%~1"=="/nopause" pause
