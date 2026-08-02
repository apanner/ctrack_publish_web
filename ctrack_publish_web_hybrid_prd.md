# CTrack Publish — Web Hybrid PRD
**Version:** 1.0  
**Date:** 2026-05-08  
**Status:** Draft → Ready for Build

---

## 1. Problem Statement

`ctrack_publish` (Electron) is a heavy application:
- ~150–200 MB installed (Electron runtime + Chromium)
- Requires manual install on each machine
- Tied to Windows (or per-platform builds)
- Cannot be accessed from another machine, tablet, or browser
- Electron runtime overhead even when doing simple context/publish tasks

**Goal:** One lightweight native engine binary + a hosted web UI.  
Artists log in once. The engine runs silently in the system tray.  
The web app connects to it automatically. Same publish quality, anywhere.

---

## 2. Product Vision

> "Download a 15 MB engine. Everything else lives in the browser.  
> Open `publish.ctrack.io` from any machine — if your engine is running locally,  
> files are processed at full speed on your workstation and pushed straight to S3.  
> If not, the web still works via cloud fallback."

---

## 3. User Flow — One-Click Experience

```
1. Visit publish.ctrack.io
2. Log in with Google / Email (Supabase Auth)
3. Banner: "No local engine detected — Download CTrack Engine (14 MB)"
4. Click download → ctrack-engine-setup.exe runs
5. Engine installs silently, starts, adds to system tray
6. Page auto-detects engine (polls localhost:7777/health)
7. Banner turns green: "Engine connected — Processing locally"
8. User selects project → shot → task → drops file → Publish
9. Engine transcodes + generates proxy + uploads to S3
10. shot_versions row created, notifications sent
11. Done. Browser shows completed job.
```

No Python install. No Node.js install. No Electron. No manual config.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  WEB APP  (hosted — publish.ctrack.io)                          │
│  Vite + React + TailwindCSS + Supabase Auth                     │
│                                                                 │
│  Engine status badge  ←─── GET http://localhost:7777/health    │
│  File drop / browser pick                                       │
│  Job queue UI (SSE stream from engine)                          │
│  Context bar (project → shot → task)                            │
│  Settings page                                                  │
└────────────┬────────────────────────────────────────────────────┘
             │ http://localhost:7777  (localhost — always allowed from HTTPS)
┌────────────▼────────────────────────────────────────────────────┐
│  CTRACK ENGINE  (local binary — runs in system tray)            │
│  Node.js bundled with `pkg`  →  ctrack-engine.exe  (~14 MB)    │
│                                                                 │
│  POST /api/upload        ← receive file chunks from browser    │
│  POST /api/jobs          ← create job                          │
│  POST /api/jobs/:id/run  ← trigger FFmpeg/Python pipeline      │
│  GET  /api/jobs          ← list jobs                           │
│  GET  /api/jobs/:id/events (SSE) ← live progress stream       │
│  GET  /health            ← "I'm alive" + version              │
│  POST /api/scan          ← scan local folder (bulk ingest)     │
│                                                                 │
│  Reused from ctrack_publish (zero changes):                    │
│    python/engine.py + modules/*                                 │
│    electron/s3-manager.ts → engine/s3-manager.ts               │
│    python/.env for AWS / MinIO credentials                     │
└────────────┬────────────────────────────────────────────────────┘
             │
   ┌─────────┴──────────┐      ┌────────────────────┐
   │  Local Disk        │      │  S3 / MinIO         │
   │  EXR sequences     │─────▶│  Direct upload      │
   │  Videos / proxies  │      │  (no server hop)    │
   └────────────────────┘      └────────┬────────────┘
                                        │
                               ┌────────▼────────────┐
                               │  Supabase           │
                               │  shot_versions      │
                               │  shot_elements      │
                               │  publish_jobs       │
                               │  notifications      │
                               └─────────────────────┘
```

---

## 5. Why Node.js + `pkg` (Not C++ / Java / Electron)

| Option | Binary size | Install | Complexity | Verdict |
|--------|-------------|---------|------------|---------|
| **Java** | 200MB (needs JRE) | Heavy | Medium | ❌ Not lightweight |
| **C++** | 2MB | Simple | Very hard to build cross-platform | ❌ Too complex |
| **Electron (stripped)** | 100MB | Medium | Low (reuse all code) | ⚠️ Still heavy |
| **Go binary** | 8MB | Zero | Medium (rewrite) | ✅ Long-term ideal |
| **Node.js + pkg** | 14MB | Zero | Low (reuse all code) | ✅ **Ship now** |

**Decision: Node.js + `pkg` for v1.** Same codebase, strip Electron, bundle with `pkg`.  
**Decision: Go rewrite for v2** if binary size matters after shipping.

### Why Python still works without installing Python
`pkg` bundles Node.js. The Python engine is a **sidecar process** — the engine ships
`python/` folder + downloads `static-ffmpeg` on first launch (once, cached in `%APPDATA%\ctrack-engine\`).  
Alternatively, a bundled portable Python (~25MB extra) removes all first-run downloads.  
**v1 recommendation:** use `static-ffmpeg` auto-download (Python is already on most VFX workstations).

---

## 6. Component Breakdown

### 6.1 — Engine (Local Binary)

**Source:** `d:\dev\track\ctrack_publish_web\engine\`

**Core files (reused 1:1 from ctrack_publish):**

| Source (ctrack_publish) | Destination (engine) | Changes |
|-------------------------|---------------------|---------|
| `electron/s3-manager.ts` | `engine/s3-manager.ts` | None |
| `electron/queue-manager.ts` | `engine/queue-manager.ts` | Replace `app.getPath` with `os.homedir()` |
| `python/engine.py` | `engine/python/engine.py` | None |
| `python/modules/*` | `engine/python/modules/*` | None |
| `src/types/settings.ts` | `engine/types/settings.ts` | None |

**New files:**

| File | Purpose |
|------|---------|
| `engine/server.ts` | Express HTTP server (~200 lines, replaces electron/main.ts IPC) |
| `engine/python-bridge.ts` | Thin wrapper — replaces PythonManager, same logic |
| `engine/tray.ts` | System tray icon (Windows: .ico, macOS: .icns) |
| `engine/updater.ts` | Auto-update check against GitHub releases |
| `engine/auth-sync.ts` | Sync Supabase session token with web app |
| `engine/settings-store.ts` | Read/write settings.json in AppData |
| `engine/package.json` | `pkg` config: targets win-x64, mac-x64, linux-x64 |

**Engine server.ts — HTTP API surface:**

```
GET  /health
     → { version, status: "ok", pythonReady: bool, platform }

POST /api/upload
     → multipart/form-data, streams to temp dir, returns { stagingPath }

POST /api/jobs
     → { filePath, projectId, shotId, taskId, meta, options }
     → Creates job in SQLite queue, returns { id }

POST /api/jobs/:id/run
     → Triggers Python pipeline (transcode → webp → S3 → Supabase insert)

GET  /api/jobs
     → Returns job list (last 50)

GET  /api/jobs/:id/events
     → SSE stream of job_events rows as they happen

DELETE /api/jobs/:id
     → Remove job from queue

POST /api/scan
     → { folderPath } → calls python scan_folder, returns scan results

GET  /api/settings
     → Current AppSettings

PUT  /api/settings
     → Save AppSettings to local JSON
```

**CORS policy (security — never skip this):**
```typescript
cors({
  origin: [
    'https://publish.ctrack.io',     // production web
    'http://localhost:5173',          // local web dev
    'http://localhost:4173',          // local preview
  ]
})
```

**Packaging:**
```jsonc
// package.json
{
  "scripts": {
    "build": "tsc && pkg dist/server.js --targets node18-win-x64,node18-mac-x64 --output build/ctrack-engine"
  },
  "pkg": {
    "assets": ["python/**/*", "resources/**/*"],
    "scripts": ["dist/**/*.js"]
  }
}
```

Output: `ctrack-engine.exe` (~14 MB on Windows, ~16 MB on macOS).

---

### 6.2 — Web App

**Source:** `d:\dev\track\ctrack_publish_web\web\`

**Reused from ctrack_publish (copy, no IPC references):**

| File | Reuse | Note |
|------|-------|------|
| `src/lib/supabase.ts` | ✅ Verbatim | |
| `src/lib/path-utils.ts` | ✅ Verbatim | |
| `src/lib/path-context.ts` | ✅ Verbatim | |
| `src/lib/utils.ts` | ✅ Verbatim | |
| `src/lib/task-department-mapper.ts` | ✅ Verbatim | |
| `src/lib/error-message.ts` | ✅ Verbatim | |
| `src/hooks/use-auth.ts` | ✅ Verbatim | (Supabase only, no IPC) |
| `src/hooks/use-ctrack-data.ts` | ✅ Verbatim | (Supabase only) |
| `src/hooks/use-context-store.ts` | ✅ Verbatim | (Zustand only) |
| `src/store/app-log-store.ts` | ✅ Verbatim | |
| `src/types/*` | ✅ Verbatim | |
| `src/components/ui/*` | ✅ Verbatim | |
| `src/components/auth/*` | ✅ Verbatim | |
| `src/components/layout/ContextBar.tsx` | ✅ Verbatim | |
| `src/components/layout/AppConsole.tsx` | ✅ Verbatim | |
| `src/components/layout/SequenceHealthBar.tsx` | ✅ Verbatim | |
| `src/components/layout/QueueList.tsx` | ✅ Minor | remove IPC types |
| `src/components/layout/StagingZone.tsx` | ✅ Adapt | replace IPC path processing |
| `src/hooks/usePublishQueue.ts` | ✅ Adapt | replace `window.ipcRenderer` with `engineClient` |
| `src/views/QuickPublishView.tsx` | ✅ Adapt | use web file picker |
| `src/views/QueueView.tsx` | ✅ Minor | |
| `src/views/SettingsView.tsx` | ✅ Adapt | settings via engine API |
| `src/views/BulkIngestView.tsx` | ✅ Adapt | scan via engine API |

**New files in web app:**

| File | Purpose |
|------|---------|
| `src/lib/engine-client.ts` | Drop-in replacement for `window.ipcRenderer.invoke(...)` |
| `src/hooks/use-engine-status.ts` | Poll `/health`, expose `{ connected, version }` |
| `src/components/layout/EngineStatusBadge.tsx` | Green/yellow badge in top bar |
| `src/components/onboarding/EngineDownloadBanner.tsx` | First-run download CTA |
| `src/App.tsx` | Replace IPC OAuth with `supabase.auth.onAuthStateChange` |

**`engine-client.ts` — the only real new code:**

```typescript
// src/lib/engine-client.ts
// Replaces every: (window as any).ipcRenderer.invoke('channel', payload)
// With:           engineClient.invoke('channel', payload)

const ENGINE_BASE = 'http://localhost:7777'

export const engineClient = {
  async invoke(channel: string, payload?: unknown): Promise<unknown> {
    const routeMap: Record<string, { method: string; path: (p: any) => string }> = {
      'python-command':              { method: 'POST', path: () => '/api/jobs/python' },
      'upload-s3':                   { method: 'POST', path: () => '/api/s3/upload' },
      'queue:add-job':               { method: 'POST', path: () => '/api/jobs' },
      'queue:get-jobs':              { method: 'GET',  path: () => '/api/jobs' },
      'queue:update-job':            { method: 'PATCH', path: (p) => `/api/jobs/${p.id}` },
      'queue:remove-job':            { method: 'DELETE', path: (p) => `/api/jobs/${p}` },
      'queue:add-event':             { method: 'POST', path: () => '/api/job-events' },
      'queue:get-events':            { method: 'GET', path: (p) => `/api/jobs/${p.jobId}/events` },
      'settings:read':               { method: 'GET', path: () => '/api/settings' },
      'settings:write':              { method: 'PUT', path: () => '/api/settings' },
      'video-metadata':              { method: 'POST', path: () => '/api/video-metadata' },
      'staging:process-paths':       { method: 'POST', path: () => '/api/scan/paths' },
      'app:get-temp-path':           { method: 'GET', path: () => '/api/temp-path' },
      'app:ensure-dir':              { method: 'POST', path: () => '/api/ensure-dir' },
      'fs:delete-file':              { method: 'DELETE', path: () => '/api/fs/file' },
      'notify':                      { method: 'POST', path: () => '/api/notify' },
    }
    const route = routeMap[channel]
    if (!route) throw new Error(`Unknown engine channel: ${channel}`)
    const method = route.method
    const path = route.path(payload)
    const res = await fetch(`${ENGINE_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method !== 'GET' ? JSON.stringify(payload) : undefined,
    })
    if (!res.ok) throw new Error(`Engine error ${res.status}: ${await res.text()}`)
    return res.json()
  },

  streamEvents(jobId: string): EventSource {
    return new EventSource(`${ENGINE_BASE}/api/jobs/${jobId}/events`)
  },

  async uploadFile(jobId: string, file: File, onProgress?: (p: number) => void): Promise<string> {
    // XMLHttpRequest for progress support
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const fd = new FormData()
      fd.append('file', file)
      fd.append('jobId', jobId)
      xhr.upload.onprogress = (e) => onProgress?.(Math.round((e.loaded / e.total) * 100))
      xhr.onload = () => xhr.status < 400 ? resolve(JSON.parse(xhr.responseText).stagingPath) : reject(xhr.responseText)
      xhr.onerror = () => reject('Upload failed')
      xhr.open('POST', `${ENGINE_BASE}/api/upload`)
      xhr.send(fd)
    })
  }
}
```

Then in `usePublishQueue.ts`, the entire migration is a single find-replace:
```
(window as any).ipcRenderer.invoke  →  engineClient.invoke
ipcRenderer.on('python-log', ...)   →  SSE stream events
```

---

### 6.3 — Engine Status Badge

```
[🟢 Engine v1.2 — Local]   Processing happens on your machine
[🟡 Engine offline]        [Download Engine ↓]  |  jobs queued
[🔴 Engine error]          [Restart Engine]
```

Displayed in the `AppShell` top bar.  
When offline, jobs are still created (queued in Supabase) — they run when engine reconnects.

---

### 6.4 — Auth Sync (Browser ↔ Engine)

The engine doesn't need to log in separately. The web app passes the Supabase JWT:

```typescript
// Web app: attach token to every engine request
const { data: { session } } = await supabase.auth.getSession()
headers: { 'Authorization': `Bearer ${session.access_token}` }

// Engine server: validate JWT, use it for Supabase inserts
const supabase = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.authorization } } })
```

Result: engine makes Supabase calls **as the logged-in user** — RLS policies work exactly as in the desktop app.

---

## 7. Installer

### Windows
- **NSIS** installer: `ctrack-engine-setup-1.0.0.exe`
- Installs to `%LOCALAPPDATA%\CTrack Engine\`
- Creates start menu + optional startup entry
- Shows Windows tray icon on first run
- Size on disk: ~18 MB (engine exe + python scripts + icon assets)

### macOS (future)
- `.dmg` with drag to `/Applications`
- LaunchAgent plist for auto-start

### Silent install command (for IT/studio deployment):
```batch
ctrack-engine-setup-1.0.0.exe /S /AUTOSTART=1
```

---

## 8. Auto-Update

On engine start → check `https://publish.ctrack.io/api/engine-version`.  
If newer version available → tray balloon: "CTrack Engine update available — click to install".  
Download new exe → replace → restart (Windows: `NSIS updater` or `winget` manifest).

---

## 9. Processing Flow (Smooth, No PC Freeze)

```
Browser drop / file pick
  ↓
POST /api/upload  (chunked, streamed to disk — never buffered in RAM)
  ↓
Job created in SQLite queue (status: idle)
  ↓
POST /api/jobs/:id/run
  ↓
Engine spawns python/engine.py (existing sidecar, zero changes)
  Python runs FFmpeg with: nice +10, -threads N/2   ← no PC freeze
  ↓
SSE events → browser (frame=N progress, stage transitions)
  ↓
S3Manager.uploadFile() from disk (direct, no RAM buffer)
  ↓
supabase.from('shot_versions').insert(...)  ← as logged-in user
  ↓
rpc_notify_recipients(...)
  ↓
SSE: { status: 'completed', progress: 100 }
  ↓
Temp files cleaned from disk
```

**CPU guard (no freeze):**
```typescript
// engine/python-bridge.ts
spawn('python', ['engine.py'], {
  env: { ...process.env, FFMPEG_NICE: '10' }  // picked up in transcode.py
})
// In transcode.py: prepend ['nice', '-n', '10'] on mac/linux
// On Windows: use SetPriorityClass(BELOW_NORMAL_PRIORITY_CLASS) via taskkill/python ctypes
```

**Concurrent job limit:**
```typescript
const MAX_CONCURRENT = 2  // configurable in settings
// Jobs beyond limit stay 'idle', auto-start via processNextJob()
```

---

## 10. Supabase Schema Additions

Only two new tables needed (everything else already exists):

```sql
-- Job queue (replaces SQLite — synced to cloud for visibility)
create table publish_jobs (
  id           text primary key,
  user_id      uuid references auth.users not null,
  status       text not null default 'idle',
  progress     int default 0,
  error        text,
  file_path    text,
  project_id   uuid,
  shot_id      uuid,
  shot_code    text,
  task_id      uuid,
  task_name    text,
  tracking_number text,
  meta         jsonb,
  created_at   timestamptz default now()
);
alter table publish_jobs enable row level security;
create policy "Users see own jobs"
  on publish_jobs for all using (user_id = auth.uid());

-- Job events (replaces job_events SQLite table)
create table publish_job_events (
  id          bigserial primary key,
  job_id      text references publish_jobs(id) on delete cascade,
  run_id      text,
  level       text default 'info',
  component   text default 'renderer',
  stage       text,
  event_type  text default 'log',
  message     text not null,
  payload     jsonb,
  created_at  timestamptz default now()
);
create index on publish_job_events(job_id, created_at);
alter table publish_job_events enable row level security;
create policy "Users see events for own jobs"
  on publish_job_events for all
  using (job_id in (select id from publish_jobs where user_id = auth.uid()));
```

> **Note:** The engine ALSO keeps a local SQLite copy (existing `queue-manager.ts`) for offline resilience.
> Supabase is the source-of-truth for the web UI. Local SQLite is the source-of-truth for the engine.
> They sync on job status changes.

---

## 11. Feature Parity vs ctrack_publish

| Feature | Desktop | Web Hybrid | Notes |
|---------|---------|-----------|-------|
| Quick Publish (version) | ✅ | ✅ | Full parity |
| Quick Publish (element) | ✅ | ✅ | Full parity |
| Bulk Ingest (folder scan) | ✅ | ✅ | Via `/api/scan` — engine has local disk access |
| EXR sequence transcode | ✅ | ✅ | engine.py, same chunked FFmpeg |
| Burn-in text | ✅ | ✅ | Same drawtext filter |
| WebP preview + thumbnails | ✅ | ✅ | Same Python pipeline |
| H.265 (libx265) | ✅ | ✅ | Engine, not browser |
| S3 direct upload | ✅ | ✅ | S3Manager unchanged |
| MinIO hybrid | ✅ | ✅ | S3Manager unchanged |
| Frame range detection | ✅ | ✅ | video-metadata via engine |
| Smart-Fill path context | ✅ | ✅ | Engine scans path on drop |
| Supabase notifications | ✅ | ✅ | Same rpc_notify_recipients |
| OS notifications | ✅ Electron | ✅ Web Push / tray balloon | Minor UX difference |
| Queue persistence | ✅ SQLite | ✅ SQLite + Supabase sync | More resilient |
| Settings | ✅ Local JSON | ✅ Local JSON via engine API | |
| Access from other machine | ❌ | ✅ | Key new capability |
| Mobile / tablet view | ❌ | ✅ Responsive | |
| Auto-update | ✅ electron-builder | ✅ NSIS / GitHub Releases | |

---

## 12. Build & Ship Checklist

```
engine/
  [ ] server.ts — HTTP routes (adapts electron/main.ts IPC handlers)
  [ ] python-bridge.ts — spawns engine.py (same as PythonManager)
  [ ] s3-manager.ts — copied from electron/s3-manager.ts (unchanged)
  [ ] queue-manager.ts — copied, replace app.getPath with os.homedir()
  [ ] settings-store.ts — read/write %APPDATA%\ctrack-engine\settings.json
  [ ] tray.ts — system tray icon + menu (start/stop/open)
  [ ] updater.ts — GitHub Releases version check
  [ ] auth-sync.ts — validate Supabase JWT on each request
  [ ] python/ — copied from ctrack_publish/python/ (unchanged)
  [ ] package.json — pkg targets, assets config

web/
  [ ] src/lib/engine-client.ts — NEW (replaces window.ipcRenderer)
  [ ] src/hooks/use-engine-status.ts — NEW (polls /health)
  [ ] src/components/layout/EngineStatusBadge.tsx — NEW
  [ ] src/components/onboarding/EngineDownloadBanner.tsx — NEW
  [ ] src/App.tsx — replace Electron OAuth with Supabase web auth
  [ ] src/hooks/usePublishQueue.ts — swap ipcRenderer → engineClient
  [ ] src/components/layout/StagingZone.tsx — adapt file picker
  [ ] src/views/SettingsView.tsx — settings via engine API
  [ ] All other components — copied verbatim from ctrack_publish

infra/
  [ ] Supabase: create publish_jobs + publish_job_events tables + RLS
  [ ] Host web app (Vercel / Netlify / self-hosted)
  [ ] NSIS installer script for Windows
  [ ] GitHub Actions: build engine.exe on tag → release
  [ ] Engine version endpoint: GET /api/engine-version on hosted web
```

---

## 13. Folder Structure

```
d:\dev\track\ctrack_publish_web\
├── ctrack_publish_web_hybrid_prd.md   ← this file
├── engine\                             ← local engine (Node + pkg)
│   ├── src\
│   │   ├── server.ts
│   │   ├── python-bridge.ts
│   │   ├── s3-manager.ts
│   │   ├── queue-manager.ts
│   │   ├── settings-store.ts
│   │   ├── tray.ts
│   │   ├── updater.ts
│   │   └── auth-sync.ts
│   ├── python\                         ← copied from ctrack_publish/python/
│   ├── resources\
│   │   └── icons\
│   ├── package.json
│   └── tsconfig.json
├── web\                                ← hosted web app
│   ├── src\
│   │   ├── lib\
│   │   │   └── engine-client.ts       ← NEW: replaces ipcRenderer
│   │   ├── hooks\
│   │   │   └── use-engine-status.ts   ← NEW
│   │   ├── components\
│   │   │   └── layout\
│   │   │       └── EngineStatusBadge.tsx  ← NEW
│   │   └── ... (rest copied from ctrack_publish/src/)
│   ├── package.json
│   └── vite.config.ts
└── installer\
    └── setup.nsi                       ← NSIS installer script
```

---

## 14. Estimated Effort

| Task | Days |
|------|------|
| engine/server.ts (HTTP routes from IPC) | 2 |
| engine/tray.ts + packaging + NSIS | 1 |
| Supabase tables + RLS | 0.5 |
| web/engine-client.ts | 1 |
| web/usePublishQueue.ts adaptation | 1 |
| web/StagingZone + auth + App.tsx | 1 |
| web/EngineStatusBadge + DownloadBanner | 0.5 |
| Copy all unchanged components | 0.5 |
| Testing end-to-end + edge cases | 2 |
| NSIS installer + auto-update | 1 |
| **Total** | **~10 days** |

---

## 15. Success Metrics

- Engine binary: **< 20 MB**
- Install + first run: **< 60 seconds**
- Transcode + S3 upload parity with desktop: **same speed** (same machine, same FFmpeg)
- Web app loads without engine: **< 2 seconds**
- Engine reconnection after wake/restart: **< 5 seconds** (auto-polling)
- CPU usage while idle: **< 1%** (engine is a sleeping HTTP server)

---

## 16. Out of Scope (v1)

- Cloud worker fallback (engine required in v1; cloud fallback is v2)
- Mobile file upload from phone (file picker works but large sequences impractical)
- Linux engine binary (add in v1.1 — `pkg` supports it, just needs testing)
- Multi-engine (two machines publishing simultaneously) — v3
