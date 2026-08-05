@echo off
setlocal
cd /d "%~dp0..\engine-go"

where go >nul 2>nul
if errorlevel 1 (
  echo [ctrack] Go toolchain not found. Install Go 1.22+ to build ctrack-engine.exe
  exit /b 1
)

go mod tidy
if errorlevel 1 exit /b 1

set "OUT=%~dp0..\release"
if not exist "%OUT%" mkdir "%OUT%"

go mod tidy
if errorlevel 1 exit /b 1

go build -ldflags "-H windowsgui" -o "%OUT%\ctrack-engine.exe" .\cmd\ctrack-engine
if errorlevel 1 exit /b 1

echo [ctrack] Built %OUT%\ctrack-engine.exe
exit /b 0
