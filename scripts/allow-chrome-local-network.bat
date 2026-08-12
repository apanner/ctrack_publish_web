@echo off
:: Elevate and allow Chrome/Edge local-network access for CTrack (Vercel → 127.0.0.1).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0allow-chrome-local-network.ps1"
if errorlevel 1 pause
