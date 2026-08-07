# Release & Deploy — CTrack Publish

> **CI-only releases:** see **[RELEASE.md](./RELEASE.md)** — push to GitHub; do not build or deploy production artifacts locally.

Quick reference after DB migration is applied. For **hybrid MinIO + AWS S3** setup and testing see [DUAL_STORAGE.md](./DUAL_STORAGE.md).

## Deploy Edge Functions to Supabase (step by step)

All deploy scripts load **`ctrack_publish_web/.env`** automatically (via `scripts/load-deploy-env.ps1`).
Missing keys are merged from `../ctrack_v0/.env.local` (e.g. `SUPABASE_SERVICE_ROLE_KEY`).

Functions live in **`ctrack_publish_web/supabase/functions/`** (vendored from `ctrack_v0` for CI).

### 1. Add deploy token to `.env`

In `ctrack_publish_web/.env`:

```env
SUPABASE_ACCESS_TOKEN=sbp_your_token_here
```

Get token: [Supabase Account → Access Tokens](https://supabase.com/dashboard/account/tokens)

Or login once instead: `npm run deploy:edge:login`

### 2. Deploy all four functions

```powershell
cd d:\dev\track\ctrack_publish_web
npm run deploy:edge
```

Or:

```powershell
scripts\deploy-edge-functions.bat
```

Deploys:

| Folder | URL |
|--------|-----|
| `engine-pair-init` | `.../functions/v1/engine-pair-init` |
| `engine-pair-complete` | `.../functions/v1/engine-pair-complete` |
| `engine-download` | `.../functions/v1/engine-download` |
| `engine-releases-latest` | `.../functions/v1/engine-releases-latest` |

### 3. Sync Edge secrets from `.env` (no manual dashboard copy)

```powershell
npm run deploy:edge:secrets
```

Reads `ctrack_publish_web/.env` + `engine/.env` + `ctrack_v0/.env.local` and pushes GitHub + Supabase credentials to Supabase Edge secrets.

Note: Supabase auto-injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — the CLI skips those (already available in Edge Functions).

Legacy AWS/MinIO secrets are included only when present in `.env` (for older S3-hosted releases).

### 4. Set Edge secrets manually (optional)

Supabase Dashboard → **Project** `czwfeqheduofviockrab` → **Edge Functions** → **Secrets**:

| Secret name | Value |
|-------------|--------|
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role |
| `GITHUB_RELEASE_TOKEN` | GitHub PAT with `repo` / `contents: read` (for private repos) |
| `GITHUB_REPOSITORY` | e.g. `apanner/ctrack_mobile_v0` (optional — inferred from release row) |

Legacy (only if you still have S3-hosted releases):

| Secret name | Value |
|-------------|--------|
| `AWS_ACCESS_KEY_ID` | Your IAM key |
| `AWS_SECRET_ACCESS_KEY` | Your IAM secret |
| `AWS_REGION` | e.g. `ap-south-1` |
| `AWS_S3_BUCKET` | Bucket that held `ctrack-downloads/...` |
| `HYBRID_STORAGE_PRIMARY_*` | MinIO backup (optional) |

> Prefer `npm run deploy:edge:secrets` over manual copy.

### 4. Verify deploy

```powershell
npm run deploy:verify
```

Expected: `OK — latest release version: ...` (or 404 if no row in `engine_releases` yet).

### Manual deploy (one function)

```powershell
cd d:\dev\track\ctrack_v0
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
npx supabase@latest functions deploy engine-download --project-ref czwfeqheduofviockrab --no-verify-jwt
```

### Troubleshooting

| Error | Fix |
|-------|-----|
| `Missing SUPABASE_ACCESS_TOKEN` | Set `sbp_...` token (step 1) |
| `Invalid access token` / 401 | Regenerate token; no extra spaces |
| `Bundle generation failed` on `engine-download` | Ensure `engine-download/deno.json` exists; redeploy |
| `Missing SUPABASE_SERVICE_ROLE_KEY` at runtime | Add secret in Dashboard (step 3) |
| `Missing environment variable: GITHUB_RELEASE_TOKEN` | Add PAT to `.env` and run `npm run deploy:edge:secrets` |
| `Release not found` (404) | Run a release publish first or insert a row in `engine_releases` |
| CORS / 401 from browser | Functions use `--no-verify-jwt`; still send `apikey` + `Authorization: Bearer <anon or user JWT>` |

Alternative login (stores token in CLI config):

```powershell
npx supabase@latest login
cd d:\dev\track\ctrack_v0
npx supabase@latest link --project-ref czwfeqheduofviockrab
npx supabase@latest functions deploy engine-pair-init --no-verify-jwt
```

---

| Mode | Trigger | What runs |
|------|---------|-----------|
| **Dev** | Push/PR to `main` / `develop` | `npm ci` + build engine + web on **windows-latest** |
| **Engine release** | Git tag `v*` or manual dispatch | **windows-latest** → installers + GitHub Release + edge functions |

## Local scripts

From `ctrack_publish_web/`:

```powershell
# Dev build only (fast — skips npm install; stop engine tray first if install fails)
npm run deploy:dev

# Fresh install + build
powershell -File scripts/deploy-dev.ps1 -Install

# Dev build + release folder + installers
powershell -File scripts/deploy-dev.ps1 -ReleaseFolder -Installer

# Deploy Edge Functions only (DB already updated)
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
npm run deploy:edge

# Full production deploy (edge + CI build + GitHub Release + Supabase row)
# Run via GitHub Actions — or locally only if you must test the script:
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
$env:SUPABASE_URL = "https://czwfeqheduofviockrab.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "..."
$env:GITHUB_TOKEN = "ghp_..."   # PAT with contents:write
npm run deploy:release
```

## Edge Functions deployed

| Function | URL path |
|----------|----------|
| `engine-pair-init` | `/functions/v1/engine-pair-init` |
| `engine-pair-complete` | `/functions/v1/engine-pair-complete` |
| `engine-download` | `/functions/v1/engine-download` |
| `engine-releases-latest` | `/functions/v1/engine-releases-latest` |

Source: `ctrack_publish_web/supabase/functions/<name>/index.ts`

## GitHub secrets (Deploy workflow)

| Secret | Purpose |
|--------|---------|
| `SUPABASE_ACCESS_TOKEN` | CLI deploy (`sbp_...` from Supabase account tokens) |
| `SUPABASE_URL` | Release upsert + edge env |
| `SUPABASE_SERVICE_ROLE_KEY` | `engine_releases` REST upsert |
| `CTRACK_GH_TOKEN` | Optional PAT for private-repo asset downloads in edge (Actions uses built-in `GITHUB_TOKEN` for releases) |

`GITHUB_TOKEN` is provided automatically in Actions (`contents: write` for creating releases).

## Supabase Edge secrets (set once)

```powershell
npm run deploy:edge:secrets
```

Requires in `.env`:

- `SUPABASE_SERVICE_ROLE_KEY`
- `GITHUB_RELEASE_TOKEN` (or `GITHUB_TOKEN`) — same PAT the edge function uses to resolve GitHub asset URLs

## Release a new version (GitHub Actions — no local build)

```powershell
# 1. Bump semver in version.json
powershell -File scripts/release-bump.ps1 -Part patch

# 2. Commit + tag — CI builds Windows installers and publishes GitHub Release
git add version.json
git commit -m "chore: bump engine to 0.1.3"
git tag v0.1.3
git push origin main --tags
```

The **CTrack Deploy** workflow on `windows-latest`:

1. `npm ci` + Inno Setup
2. Builds `CTrackPublishEngine-Setup.exe` + `CTrackNuke-Setup.exe`
3. Creates/updates GitHub Release `v0.1.3` with installers + `latest.json`
4. Upserts `engine_releases` (`s3_prefix` = `github:owner/repo`, asset names in `engine_s3_key` / `nuke_s3_key`)
5. Deploys Edge Functions (unless skipped)

Installers live on **GitHub Releases** — not S3. Facility publish uploads (MinIO/S3 hybrid) are unchanged; see [DUAL_STORAGE.md](./DUAL_STORAGE.md).

Tag push triggers **Deploy** workflow automatically.

### First-time GitHub setup

1. Copy deploy env: `copy .env.deploy.example .env.deploy` and fill `SUPABASE_*` + `GITHUB_RELEASE_TOKEN`.
2. Push secrets to GitHub: `npm run deploy:secrets:github`
3. Commit and push `.github/workflows/ctrack-deploy.yml` + `ctrack_publish_web/` (workflow must exist on `main`).
4. Trigger without local build: `npm run deploy:release:remote`

Or: GitHub → Actions → **CTrack Deploy (release)** → Run workflow.

Options: skip build, skip edge, channel, release notes.

---

## Local workstation GUI

The Windows tray and sign-in UI live under `engine/python/gui/`. Full component list and flows: [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md).

### Start tray (production layout)

```powershell
wscript scripts\start-engine-tray.vbs
```

### Start tray (dev tree)

```powershell
cd d:\dev\track\ctrack_publish_web
npm run build -w engine
wscript scripts\start-engine-tray.vbs
```

### Verify engine + auth

```powershell
curl http://127.0.0.1:7777/health
curl http://127.0.0.1:7777/api/auth/status
```

### Engine `.env` (pairing)

In `engine/.env` (or `%USERPROFILE%\.ctrack-engine\.env`):

```env
SUPABASE_URL=https://czwfeqheduofviockrab.supabase.co
CTRACK_WEB_URL=https://ctrackpublishweb.vercel.app
CTRACK_WEB_ORIGINS=https://ctrackpublishweb.vercel.app,http://localhost:5173,http://127.0.0.1:5173
```

Supabase Auth → Redirect URLs must include `https://ctrackpublishweb.vercel.app/link-engine` (and localhost equivalent for dev).

### Stale tray / login locks

If tray reports “already running” with no UI:

```powershell
Remove-Item "$env:USERPROFILE\.ctrack-engine\tray.lock" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\.ctrack-engine\login.lock" -Force -ErrorAction SilentlyContinue
wscript scripts\start-engine-tray.vbs
```
