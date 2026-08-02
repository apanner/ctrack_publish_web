@echo off
setlocal
REM Run from repo clone: starts engine\ (Node on PATH required)
pushd "%~dp0..\engine"
if not exist "dist\server.js" (
  echo [ctrack] Build first: scripts\build-release.bat
  popd
  pause
  exit /b 1
)
echo [ctrack] Engine http://127.0.0.1:7777 — close this window to stop.
node dist\server.js
popd
pause
