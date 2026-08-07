# Release & Deploy — CTrack Publish

**Do not build or deploy production artifacts on your laptop.** Push to GitHub; Actions build and ship everything.

| Artifact | Where it ships | Trigger |
|----------|----------------|---------|
| **Web UI** | [ctrackpublishweb.vercel.app](https://ctrackpublishweb.vercel.app) | Push to `main` (web changes) |
| **Windows engine installer** | GitHub Releases | Git tag `v*` (e.g. `v0.1.11`) |
| **Supabase Edge Functions** | Supabase project | Tag release workflow (or manual skip) |

---

## One-time setup

### 1. GitHub repository secrets

Copy `/.env.deploy.example` → `/.env.deploy` and fill values, then:

```powershell
cd d:\dev\track\ctrack_publish_web
npm run deploy:secrets:github
```

Required secrets:

| Secret | Used by | How to get |
|--------|---------|------------|
| `VERCEL_TOKEN` | Web deploy | [Vercel → Account → Tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Web deploy | `vercel link` → `.vercel/project.json` → `orgId` |
| `VERCEL_PROJECT_ID` | Web deploy | `.vercel/project.json` → `projectId` |
| `VITE_SUPABASE_URL` | Web build (CI) | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Web build (CI) | Supabase anon key |
| `VITE_AUTH_CALLBACK_URL` | Web build (optional) | `https://ctrackpublishweb.vercel.app/` |
| `SUPABASE_ACCESS_TOKEN` | Engine release | Supabase account token (`sbp_...`) |
| `SUPABASE_URL` | Engine release | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Engine release | service_role key |
| `CTRACK_GH_TOKEN` | Private release assets (optional) | GitHub PAT with `repo` |

> **Never commit** `.env`, `.env.deploy`, or `.vercel/`. They are gitignored.

### 2. Vercel project

The repo root contains [`vercel.json`](../vercel.json). Vercel builds **only** `web/` (`npm ci --prefix web` + `vite build`).

Disable Vercel’s automatic Git deploy if you want **GitHub Actions only** (recommended): Vercel → Project → Settings → Git → disconnect, or leave connected as backup.

### 3. Supabase Auth redirect URLs

Add to Supabase → Authentication → URL Configuration:

- `https://ctrackpublishweb.vercel.app/`
- `https://ctrackpublishweb.vercel.app/link-engine`
- `http://localhost:5173/` (dev)

---

## Day-to-day: ship web changes

1. Work on a branch; use `npm run dev` locally (no production build needed).
2. Merge / push to `main`.
3. **CTrack Deploy Web (Vercel)** workflow runs automatically when `web/**` or `vercel.json` changes.
4. Check Actions → workflow run → production URL.

Manual re-deploy without a code change:

```text
GitHub → Actions → CTrack Deploy Web (Vercel) → Run workflow
```

---

## Ship a new engine version (Windows installer)

Engine + Nuke installers are built on `windows-latest` in CI — not on your machine.

### 1. Bump version

```powershell
cd d:\dev\track\ctrack_publish_web

# Bump engine only
powershell -File scripts/release-bump.ps1 -Bump patch -Targets engine

# Bump web only
powershell -File scripts/release-bump.ps1 -Bump patch -Targets web

# Bump both (run twice or pass one target at a time)
powershell -File scripts/release-bump.ps1 -Bump patch -Targets engine
powershell -File scripts/release-bump.ps1 -Bump patch -Targets web
```

Edit [`version.json`](../version.json) — `engine` semver must match the git tag.

### 2. Commit, tag, push

```powershell
git add -A
git commit -m "chore: release engine 0.1.11 + studio storage paths"
git tag v0.1.11
git push origin main
git push origin v0.1.11
```

### 3. What CI does (`ctrack-deploy.yml`)

On tag `v*`:

1. `npm ci` (skips heavy postinstall runtimes in CI)
2. Inno Setup → `CTrackPublishEngine-Setup.exe` + Nuke installer
3. GitHub Release with assets + `latest.json`
4. Upsert `engine_releases` in Supabase
5. Deploy Edge Functions (unless skipped)

Trigger without a tag:

```powershell
npm run deploy:release:remote
```

---

## Local development only

```powershell
npm run dev          # engine :7777 + web :5173
npm run clean:all    # remove dist/, release/, .vercel/ — safe before commit
```

**Do not run** for production:

- `npm run build` then commit `web/dist`
- `vercel deploy` from your laptop
- `npm run pack:installer` unless debugging the installer script itself

---

## Workflows reference

| Workflow file | Trigger | Runner | Output |
|---------------|---------|--------|--------|
| `ctrack-dev.yml` | PR / push `main` | `windows-latest` | Verify build (no deploy) |
| `ctrack-deploy-web.yml` | push `main` (web paths) | `ubuntu-latest` | Vercel production |
| `ctrack-deploy.yml` | tag `v*` / manual | `windows-latest` | GitHub Release installers |

---

## Clean machine before commit

```powershell
npm run clean:all
git status   # should not show web/dist, engine/dist, release/, .vercel/
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Vercel deploy fails: missing token | Set `VERCEL_*` secrets via `npm run deploy:secrets:github` |
| Web build missing Supabase | Add `VITE_SUPABASE_*` to GitHub secrets |
| Engine release 404 on download | Tag must match `version.json`; check `engine_releases` row |
| `npm ci` fails on Windows locally | Use `CTRACK_SKIP_POSTINSTALL_RUNTIME=1 npm ci` or rely on CI |
| Accidentally committed `dist/` | `npm run clean:all`, `git rm -r --cached web/dist`, commit |

More detail: [DEV_AND_DEPLOY.md](./DEV_AND_DEPLOY.md)
