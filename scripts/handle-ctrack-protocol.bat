@echo off
setlocal
REM ctrack:// protocol handler — launched by Windows when a ctrack: URL is opened.
REM Usage: handle-ctrack-protocol.bat "ctrack://open"  OR  "ctrack://publish?path=D:\shot"

set "URL=%~1"
set "INSTALL=%~dp0"
set "PORT=7777"

REM Ensure tray/engine is up (idempotent — tray single-instance lock).
if exist "%INSTALL%start-engine-tray.vbs" (
  start "" /B wscript.exe //nologo "%INSTALL%start-engine-tray.vbs"
)

REM Wait briefly for :7777
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$u='%URL%'; $ok=$false; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:7777/health; if($r.StatusCode -eq 200){ $ok=$true; break } } catch {} ; Start-Sleep -Milliseconds 250 }; if($ok -and $u){ try { Invoke-RestMethod -Method Post -Uri http://127.0.0.1:7777/api/protocol/open -ContentType 'application/json' -Body (@{ url = $u } | ConvertTo-Json) | Out-Null } catch {} }; Start-Process 'http://127.0.0.1:7777/'"

endlocal
