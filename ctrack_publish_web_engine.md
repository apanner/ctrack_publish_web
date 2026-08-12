# CTrack Publish Engine — Simple Workflow

A plain-language guide to how **ctrack_publish_web** and the **local engine** work together.

---

## What you have

| Piece | What it is | Where |
|-------|------------|--------|
| **Web UI** | Browser app (projects, publish, queue) | `https://ctrackpublishweb.vercel.app` |
| **Local engine** | Worker on your PC (files, FFmpeg, uploads) | `http://127.0.0.1:7777` |
| **Tray** | Small icon in the Windows taskbar | Starts / stops the engine |
| **Supabase** | Login + accounts (same project as **ctrack_v0**) | Cloud |

The browser is the UI. The engine does the heavy local work. They share the same CTrack users via Supabase Google login.

```text
  You  →  Browser (Vercel or local UI)
              │
              │  talk to localhost
              ▼
          Engine :7777  →  files / FFmpeg / MinIO+S3
              │
              ▼
          Supabase (same as ctrack_v0)
```

---

## First-time setup (once per PC)

1. Install **CTrack Publish Engine** (Windows installer).
2. Start **CTrack Engine Tray** (Start Menu or `start-engine-tray.vbs`).
3. Confirm engine is up: open `http://127.0.0.1:7777/health` — should say `"status":"ok"`.
4. **Sign in** from the tray (not from a random Vercel tab if you can avoid it).

### Sign in (preferred — no Chrome “local network” prompt)

1. Tray → **Sign in**
2. Browser opens: `http://127.0.0.1:7777/auth/link`
3. **Sign in with Google**
4. Google returns to the **same local page**
5. Engine saves device credentials under `%USERPROFILE%\.ctrack-engine\`
6. You should see **Engine linked**

This path is **same-origin** (page and API are both on `127.0.0.1:7777`), so Chrome does not ask for “local network access.”

### Supabase Redirect URL (required)

In Supabase → Authentication → URL Configuration → Redirect URLs, include:

- `http://127.0.0.1:7777/auth/link` ← tray sign-in  
- `https://ctrackpublishweb.vercel.app/`  
- `https://ctrackpublishweb.vercel.app/link-engine`

---

## Updates (no reinstall needed)

When the workstation is **signed in / paired**:

1. Engine checks GitHub `latest.json` (or Supabase `engine_releases`) on a schedule (~4h) and on tray **Check for updates**.
2. If a newer version exists, it **downloads** the installer (authenticated via `engine-download`).
3. It runs Inno **silent upgrade** into the same install folder (`/SILENT /FORCECLOSEAPPLICATIONS`) and **restarts the tray**.

Toggle: tray menu **Auto-download updates** (on by default), or Settings → General → “Auto-download and install engine updates”.

Force off with env: `CTRACK_AUTO_UPDATE=0`.

---

## Normal day-to-day workflow

```text
1. Tray running  →  engine listening on :7777
2. Open web UI   →  Vercel or http://127.0.0.1:7777/
3. Pick project / episode / shot
4. Publish       →  browser sends job to engine
5. Engine        →  stages files, transcodes, uploads to storage
6. Queue UI      →  shows progress from engine stream
```

| Step | Who does it |
|------|-------------|
| Choose shot / notes / files | Web UI |
| Read local disks / folders | Engine |
| Transcode / thumbnails | Engine (Python + FFmpeg) |
| Upload to MinIO / S3 | Engine |
| Store shot versions in DB | Supabase (via authenticated calls) |

---

## Auth & linking (how it works)

```text
Tray "Sign in"
    →  http://127.0.0.1:7777/auth/link
    →  Google OAuth (Supabase)
    →  back to /auth/link?code=...
    →  exchange code for session
    →  POST /api/auth/pair-from-session
    →  credentials saved locally
    →  "Engine linked"
```

**Hosted fallback:** `https://ctrackpublishweb.vercel.app/link-engine`  
If you open that without a session, it should bounce to the local `/auth/link` page. Prefer tray Sign in.

**Chrome “Allow local network access?”**  
Only appears when the **public Vercel site** tries to call `127.0.0.1`.  
Avoid it by signing in on the local page. Optional admin script: `scripts/allow-chrome-local-network.bat`.

---

## Config the engine needs

**Installer builds from GitHub Actions** bake `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` into `{install}\engine\.env` automatically (from repo secrets). Fresh installs should open `/auth/link` without hand-copying `.env`.

Without those keys (dev or broken install), `/auth/link` shows: **“Supabase is not configured on the engine.”**

Put the same project keys as **ctrack_v0** in either:

| File | Typical use |
|------|-------------|
| `%USERPROFILE%\.ctrack-engine\.env` | Installed / facility machines (preferred) |
| `{install}\engine\.env` | Local install folder |
| `ctrack_publish_web/engine/.env` | Dev checkout |

Minimum for sign-in:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_URL=https://<your-project>.supabase.co
```

Also useful:

```env
CTRACK_WEB_URL=https://ctrackpublishweb.vercel.app
CTRACK_WEB_ORIGINS=https://ctrackpublishweb.vercel.app,http://localhost:5173,http://127.0.0.1:5173
CTRACK_AUTH_CALLBACK_URL=http://127.0.0.1:7777/auth/link
```

After editing `.env`, **restart the tray / engine**.

Other setup (storage, AWS, MinIO) is done via first-run setup or the same `.env` — needed for publish uploads, not for Google sign-in.

---

## Important local paths

| Path | Purpose |
|------|---------|
| `%USERPROFILE%\.ctrack-engine\.env` | Engine config (Supabase, storage, …) |
| `%USERPROFILE%\.ctrack-engine\credentials.json` (+ `.dpapi`) | Device pairing / tokens |
| `%USERPROFILE%\.ctrack-engine\ctrack_queue.db` | Publish queue |
| `%USERPROFILE%\.ctrack-engine\engine-settings.json` | Settings |
| `C:\Users\…\AppData\Local\Programs\CTrackPublishEngine\` | Installed engine |

---

## Quick checks

| Check | URL / action |
|-------|----------------|
| Engine alive? | `http://127.0.0.1:7777/health` |
| Paired? | `http://127.0.0.1:7777/api/auth/status` |
| Sign-in page | `http://127.0.0.1:7777/auth/link` |
| Hosted UI | `https://ctrackpublishweb.vercel.app` |

---

## Troubleshooting (short)

| Symptom | Likely fix |
|---------|------------|
| “Supabase is not configured on the engine” | Add `VITE_SUPABASE_*` to `~/.ctrack-engine/.env` or install `engine\.env`, restart tray |
| Spinning forever on link | Prefer tray → local `/auth/link`; keep tray running |
| Chrome asks for local network | Sign in on `127.0.0.1` instead of Vercel; or run `scripts\allow-chrome-local-network.bat` as Admin once |
| Engine not reachable | Start tray; confirm `:7777` health |
| Google redirect error | Add `http://127.0.0.1:7777/auth/link` to Supabase Redirect URLs |

---

## Repo map (optional)

| Folder | Role |
|--------|------|
| `web/` | Vite React UI (also deployed to Vercel) |
| `engine/` | Node Express API + Python worker + tray GUI |
| `supabase/functions/` | Pairing / download edge functions |
| `scripts/` | Build, tray launchers, Chrome allow script |

Same identity DB as **ctrack_v0** — one Google login, shared `profiles` / studios.
