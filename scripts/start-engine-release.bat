@echo off
setlocal
REM Shipped next to \engine folder (see build-release.bat). Do not run from repo scripts folder.
set "ROOT=%~dp0"
set "NODE_EXE=node"
if exist "%ROOT%runtime\node.exe" set "NODE_EXE=%ROOT%runtime\node.exe"
pushd "%ROOT%engine"
if not exist "dist\server.js" (
  echo [ctrack] Missing engine\dist — incomplete release folder.
  popd
  pause
  exit /b 1
)
echo [ctrack] Engine http://127.0.0.1:7777 — close this window to stop.
"%NODE_EXE%" dist\server.js
popd
pause
