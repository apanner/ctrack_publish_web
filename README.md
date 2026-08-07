# CTrack Publish — Web Hybrid Monorepo

Lightweight **local engine** (`@ctrack/engine`) plus **web UI** (`@ctrack/web`). The web app talks to the engine over `http://127.0.0.1:7777` using the same `ipcRenderer.invoke` / `on` shape as the Electron desktop app.

For the current high-level architecture and deployment summary, see [`APP_SUMMARY.md`](APP_SUMMARY.md).

**What is built (detailed):** [`docs/DEVELOPMENT_STATUS.md`](docs/DEVELOPMENT_STATUS.md) — engine, tray GUI, pairing, Supabase, Nuke, known gaps.

## GitHub repository

**https://github.com/apanner/ctrack_publish_web**

This is a **standalone repo** (not the `track` monorepo). Windows installers are built in GitHub Actions and published as [GitHub Releases](https://github.com/apanner/ctrack_publish_web/releases).

Deploy docs: [`docs/RELEASE.md`](docs/RELEASE.md) (CI-only) · [`docs/DEV_AND_DEPLOY.md`](docs/DEV_AND_DEPLOY.md) (edge functions, secrets)

## Layout

| Package | Role |
|---------|------|
| `engine/` | Express + SQLite queue + Python `engine.py` + S3 upload + staging |
| `web/` | Vite + React (ported from `ctrack_publish`) + `engine-ipc-shim` |
| `packages/shared/` | Reserved for shared types |

### How the pieces talk

1. **`web/src/lib/engine-ipc-shim.ts`** installs `window.ipcRenderer` before React boots.  
   `invoke(channel, payload)` → `POST /api/ipc` on the engine.  
   `on('python-log' | 'upload-progress' | 'queue:log-appended')` → one `EventSource` on `GET /api/stream`.
2. **`engine/src/server.ts`** maps every legacy Electron IPC channel used by the copied UI (queue, Python, S3, settings, staging, video metadata, fs, notify).
3. **`web/src/components/layout/StagingZone.tsx`** uploads browser `File` lists to `POST /api/stage/files` so paths exist on the machine running the engine (required for FFmpeg + S3).
4. **Python** lives under `engine/python/` (synced from `ctrack_publish/python`). Re-sync after changing the desktop engine:

   `robocopy d:\dev\track\ctrack_publish\python d:\dev\track\ctrack_publish_web\engine\python /E`

## Prerequisites

- Node 18+
- Python 3 with `engine/python` dependencies (same as desktop: OpenCV, ffmpeg-python, FFmpeg binary on PATH or `resources/bin`)

## Setup

```bash
cd d:\dev\track\ctrack_publish_web
npm install
```

Copy AWS / Supabase env for the engine (same variables as `ctrack_publish`):

- Place `.env` in `engine/` **or** in `%USERPROFILE%\.ctrack-engine\.env`
- Web expects `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `web/.env.example`)

### Google sign-in (Supabase)

1. **Supabase Dashboard** → Authentication → URL Configuration → **Redirect URLs**: add the exact URL your app uses after login (include scheme and port), e.g. `http://localhost:5173/` and `http://127.0.0.1:5173/` if you open the UI both ways. Match `VITE_AUTH_CALLBACK_URL` in `web/.env`, or leave it unset to default to `window.location.origin + /`.
2. **Google Cloud Console** (OAuth client used by Supabase): under **Authorized redirect URIs**, add Supabase’s callback — `https://<your-project-ref>.supabase.co/auth/v1/callback` — as shown in Supabase → Authentication → Providers → Google. You normally **do not** put `localhost:5173` there; Google redirects to Supabase first, then Supabase redirects to your app.

## Dev

Terminal 1 — engine:

```bash
npm run dev:engine
```

Terminal 2 — web:

```bash
npm run dev:web
```

Or both:

```bash
npm run dev
```

Open `http://localhost:5173`. Ensure the engine shows healthy at `http://127.0.0.1:7777/health`.

## CORS

Set `CTRACK_WEB_ORIGINS` (comma-separated) on the engine if the web app is not served from the default localhost ports.

```env
CTRACK_WEB_ORIGINS=https://ctrackpublishweb.vercel.app,http://localhost:5173,http://127.0.0.1:5173
```

## Production build & deploy (CI only)

**Do not run `npm run build` or `vercel deploy` locally for production.** Push to GitHub:

| What | How |
|------|-----|
| **Web UI** | Push to `main` → [CTrack Deploy Web](.github/workflows/ctrack-deploy-web.yml) → Vercel |
| **Engine installer** | Tag `v*` → [CTrack Deploy](.github/workflows/ctrack-deploy.yml) → GitHub Releases |

Full guide: [`docs/RELEASE.md`](docs/RELEASE.md)

Clean local artifacts before commit:

```powershell
npm run clean:all
```

### Vercel (one-time)

[`vercel.json`](vercel.json) builds **only** `web/`. Set GitHub secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` via `npm run deploy:secrets:github`.

Production URL: **https://ctrackpublishweb.vercel.app**

Supabase Auth → Redirect URLs: `https://ctrackpublishweb.vercel.app/` and `/link-engine`.

### GitHub (first push)

From this folder, after `git` is initialized and committed:

```bash
# Create an empty repo on GitHub (no README), then:
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

If you use [GitHub CLI](https://cli.github.com): `gh repo create <repo> --private --source=. --remote=origin --push`

### Windows scripts (no Electron)

The hybrid engine is **plain Node + Express** so it stays small. **Windows does not give a notification-area (tray) icon to a normal Node process** without a native or heavy UI toolkit — we intentionally **avoid Electron** here (that would duplicate the old ~150MB desktop stack).

| Script | Purpose |
|--------|---------|
| `scripts\build-release.bat` | `npm install`, build engine + web, copy `engine/dist`, `engine/python`, `web/dist` into `release\`, run **`npm install --omit=dev`** in `release\engine`, then embed portable Python + FFmpeg runtime |
| `scripts\build-python-runtime.ps1` | Downloads Windows embeddable Python into `release\engine\runtime\python`, installs `opencv-python-headless` + `ffmpeg-python`, and copies `ffmpeg.exe` / `ffprobe.exe` into `release\engine\runtime\ffmpeg` |
| `scripts\embed-node.ps1` | Downloads portable **Node** into `release\runtime\node.exe` so machines without Node.js can still run the engine |
| `scripts\build-installer.bat` | Runs release build + embed-node; if **Inno Setup 6** is installed, outputs `installer\output\CTrackPublishEngine-Setup.exe`. Use `/bundle-env` to include local `engine\.env` for a trusted facility installer |
| `installer\CTrackEngine.iss` | Inno wizard uses **`installer\branding\wizard-large.bmp`** + **`wizard-small.bmp`** (24-bit), generated from `wizard-large.*` / `wizard-small.*` by **`installer\branding\normalize-wizard-images.ps1`** — avoids Inno PNG runtime errors |
| `scripts\start-engine.bat` | From a **dev clone**: start `engine\` (run after `npm run build -w engine`) |
| `release\start-engine.bat` | After a release build: starts `release\engine\` (uses `release\runtime\node.exe` when present) |
| `release\start-engine-hidden.vbs` | Same as above but **no console window** (still **no tray icon**) |

**Why not one `.exe` from `pkg` / `nexe`?** The engine uses **`better-sqlite3`** (native addon). Bundling into a single executable is brittle; shipping **`node.exe` + `dist` + `node_modules`** is reliable on Windows.

**No manual Python install:** release/installer builds include a portable Python runtime and FFmpeg under `engine\runtime\`. The engine prefers that bundled runtime before falling back to system `py` / `python`.

**No manual config copy:** for a trusted internal build, run `scripts\build-installer.bat /bundle-env`. This bundles `engine\.env` into the setup payload so installed machines are configured immediately. Treat that installer as secret-bearing.

**System tray (shipped):** `scripts\start-engine-tray.vbs` launches the Python tray GUI (`engine/python/gui/tray_app.py`) and starts the hidden engine. Tray startup is Python GUI + `.vbs` launchers (not PowerShell WPF). Default Inno Setup shortcut uses this launcher.

**Bundled runtimes (no separate OIIO install):** `npm install` and `npm run pack:release` run `scripts/ensure-engine-runtime.ps1`, which provisions `engine/runtime/ffmpeg`, `engine/runtime/oiio`, and `engine/runtime/ocio` under the engine.
