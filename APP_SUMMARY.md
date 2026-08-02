# CTrack Publish Web - App Summary

## Product Shape

CTrack Publish Web is a hybrid publishing tool:

- **Hosted web app**: `https://ctrackpublishweb.vercel.app`
- **Local engine**: `http://127.0.0.1:7777`

The hosted web app is the user interface. The local engine is the workstation worker that handles local files, media processing, queue operations, and storage uploads.

## Why This Architecture

The web app should be easy to open and update from Vercel, but browser code cannot safely or reliably do heavy local pipeline work. The local engine exists because publishing needs access to local files, FFmpeg/OpenCV processing, S3/MinIO credentials, and long-running uploads.

The user experience should be:

1. Open the hosted web app.
2. If engine is missing, download/install the local engine.
3. Start the engine.
4. Complete first-run setup from the browser.
5. Publish from the web UI while the local engine does the heavy work.

No user should manually copy `.env` files or install Python dependencies.

## Components

### Hosted Web App

Location: `web/`

Role:

- Supabase login and app shell.
- Project/episode/shot selection.
- Quick Publish and Bulk Ingest UI.
- Queue and console display.
- Engine connection/dependency status cells.
- First-run setup form for engine config.

Deployment:

- Hosted on Vercel.
- Production URL: `https://ctrackpublishweb.vercel.app`
- Vercel builds only the `web/` package and publishes `web/dist`.

### Local Engine

Location: `engine/`

Role:

- Express API on `127.0.0.1:7777`.
- Receives web UI commands through `POST /api/ipc`.
- Streams logs/progress through `GET /api/stream`.
- Stages browser-uploaded files into local temp paths.
- Runs Python media worker.
- Uploads to S3/MinIO.
- Stores local queue/settings data.

Important endpoints:

- `GET /health`
- `GET /api/setup/status`
- `GET /api/setup/runtime-config`
- `POST /api/setup/save`
- `POST /api/ipc`
- `GET /api/stream`
- `POST /api/stage/files`

## Runtime Packaging

The engine release/installer packages its dependencies so users do not install them manually:

- Portable Node runtime: `release/runtime/node.exe`
- Portable Python runtime: `release/engine/runtime/python/python.exe`
- Python packages:
  - `opencv-python-headless`
  - `ffmpeg-python`
- FFmpeg binaries:
  - `release/engine/runtime/ffmpeg/ffmpeg.exe`
  - `release/engine/runtime/ffmpeg/ffprobe.exe`

The engine prefers bundled runtimes first, then falls back to system tools only for development.

## Configuration

Secrets are not baked into the installer. First-run setup writes configuration to:

```text
%USERPROFILE%\.ctrack-engine\.env
```

For a trusted internal/facility installer, the build can bundle the build-machine connection file:

```powershell
scripts\build-installer.bat /bundle-env
```

That copies `engine\.env` into the installer payload as `engine\.env`, so install creates the configured engine with no manual copy step. This is convenient, but the generated `.exe` contains connection data and must be shared only with trusted users/machines.

For hosted web to call the local engine, the engine must allow the hosted origin:

```env
CTRACK_WEB_ORIGINS=https://ctrackpublishweb.vercel.app,http://localhost:5173,http://127.0.0.1:5173
```

This is required because the browser is opened on Vercel but calls the engine on localhost.

## Auth Flow

Authentication uses Supabase Auth with Google:

```text
Google -> Supabase callback -> CTrack hosted web app
```

Google Cloud should allow the Supabase callback:

```text
https://<supabase-project-ref>.supabase.co/auth/v1/callback
```

Supabase redirect URLs should include:

```text
https://ctrackpublishweb.vercel.app
https://ctrackpublishweb.vercel.app/
http://localhost:5173/
http://127.0.0.1:5173/
```

Other redirect URLs may exist for other apps using the same Supabase project.

## Current Status UI

The bottom status bar reports:

- `ENGINE`: local engine reachable or not.
- `SETUP`: engine config saved or needs setup.
- `PYTHON`: Python worker script present.
- `DEPS`: Python/FFmpeg dependency check result.

If the console shows `TypeError: Failed to fetch`, that means the browser cannot reach the local engine. It does not necessarily mean dependencies are missing.

## Build And Release

Web build:

```powershell
npm run build -w web
```

Engine build:

```powershell
npm run build -w engine
```

Release folder:

```powershell
scripts\build-release.bat /nopause
```

Installer:

```powershell
scripts\build-installer.bat
```

Facility installer with bundled connection data:

```powershell
scripts\build-installer.bat /bundle-env
```

Installer output:

```text
installer\output\CTrackPublishEngine-Setup.exe
```

## Operational Checklist

For a facility/user machine:

1. Install CTrack Publish Engine.
2. Start CTrack Engine from Start Menu.
3. Open `https://ctrackpublishweb.vercel.app`.
4. Complete first-run setup in the browser.
5. Confirm bottom status bar shows engine online and dependencies ready.
6. Publish files from the web UI.

## Design Principle

The web app controls the workflow. The local engine owns local files, secrets, Python/FFmpeg processing, and uploads. Users should not manually copy config files or install command-line dependencies.
