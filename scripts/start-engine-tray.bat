@echo off
if /I not "%~1"=="--console" (
  wscript.exe //nologo "%~dp0start-engine-tray.vbs"
  exit /b 0
)
setlocal
set "ROOT=%~dp0"
set "INSTALL=%ROOT%"
if exist "%ROOT%..\engine\dist\server.js" set "INSTALL=%ROOT%.."
set "PY=%INSTALL%\runtime\python\pythonw.exe"
if not exist "%PY%" set "PY=%INSTALL%\engine\runtime\python\pythonw.exe"
if not exist "%PY%" set "PY=%INSTALL%\runtime\python\python.exe"
if not exist "%PY%" set "PY=%INSTALL%\engine\runtime\python\python.exe"
set "PYARGS="
if not exist "%PY%" (
  set "PY=py"
  set "PYARGS=-3.11"
)
cd /d "%INSTALL%\engine\python"
"%PY%" %PYARGS% -m gui --install-root "%INSTALL%"
endlocal
