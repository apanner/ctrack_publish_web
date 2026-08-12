# Release & Deploy — CTrack Publish

**Do not build or deploy production artifacts on your laptop.** Push to GitHub; Actions build and ship everything.

| Artifact | Where it ships | Trigger |
|----------|----------------|---------|
| **Web UI** | [ctrackpublishweb.vercel.app](https://ctrackpublishweb.vercel.app) | Push to `main` → **Vercel Git integration** (not GitHub Actions) |
| **Windows engine installer** | GitHub Releases | Git tag `v*` on **`windows-latest`** only |
| **Supabase Edge Functions** | Supabase project | Tag release workflow (`windows-latest`) |

---

## One-time setup

### 1. GitHub repository secrets

Copy `/.env.deploy.example` → `/.env.deploy` and fill values, then:

```powershell
cd d:\dev\track\ctrack_publish_web
npm run deploy:secrets:github
```

Required GitHub secrets (engine release only — **no Linux runners**):

| Secret | Used by | How to get |
|--------|---------|------------|
| `SUPABASE_ACCESS_TOKEN` | Engine release | Supabase account token (`sbp_...`) |
| `SUPABASE_URL` | Engine release | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Engine release | service_role key |
| `VITE_SUPABASE_URL` | **Baked into installer `.env`** | Same as ctrack_v0 `NEXT_PUBLIC_SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | **Baked into installer `.env`** | Same as ctrack_v0 `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `CTRACK_GH_TOKEN` | Private release assets (optional) | GitHub PAT with `repo` |

Optional: set `CTRACK_BUNDLE_STORAGE=1` plus AWS/MinIO secrets to bake storage credentials into the installer (facility-only).

> **Never commit** `.env`, `.env.deploy`, or `.vercel/`. They are gitignored.

CI always runs `write-engine-bundle-env.ps1` and builds with `/bundle-env`, so a fresh install has Supabase keys and `/auth/link` works without hand-copying `.env`.

### 2. Vercel project (web — no GitHub Actions)

Connect the repo in [Vercel](https://vercel.com) → Import `apanner/ctrack_publish_web`. Vercel reads [`vercel.json`](../vercel.json) and builds `web/` on **Vercel’s builders** when you push to `main`.

Set env vars in Vercel → Project → Settings → Environment Variables (must match **ctrack_v0** / same Supabase project):

- `VITE_SUPABASE_URL` = same as ctrack_v0 `NEXT_PUBLIC_SUPABASE_URL` (e.g. `https://czwfeqheduofviockrab.supabase.co`)
- `VITE_SUPABASE_ANON_KEY` = same as ctrack_v0 `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `VITE_AUTH_CALLBACK_URL` = `https://ctrackpublishweb.vercel.app/` (optional; app falls back to current origin)

Rebuild the Vercel deployment after changing `VITE_*` (they are baked in at build time).

**GitHub Actions are Windows-only** (engine installer). Do not add a Linux web-deploy workflow.

### 3. Supabase Auth redirect URLs

Same Supabase project as ctrack_v0. Add **all** of these under Authentication → URL Configuration → Redirect URLs:

- `https://ctrackpublishweb.vercel.app/`
- `https://ctrackpublishweb.vercel.app/link-engine`
- `http://localhost:5173/` (dev)
- `http://127.0.0.1:5173/` (dev, if you open Vite that way)
- `http://127.0.0.1:7777/auth/link` (**required** — tray Sign in uses this; no Chrome local-network prompt)

**Tip:** Prefer tray → **Sign in** (local `/auth/link`). If you use the Vercel UI and Chrome asks for local network access, run `scripts/allow-chrome-local-network.bat` as Administrator once, then restart Chrome.

ctrack_v0 keeps its own redirect (`…/auth/callback`). Google Cloud OAuth client only needs the shared Supabase callback: `https://<project-ref>.supabase.co/auth/v1/callback`.

---

## Day-to-day: ship web changes

1. Use `npm run dev` locally.
2. Push to `main`.
3. **Vercel** auto-builds from the Git hook (check Vercel dashboard → Deployments).

No GitHub Action runs for web.

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

### 3. What CI does (`ctrack_publish_web_deploy.yml`)

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
| `ctrack-dev.yml` | PR / push `main` | **windows-latest** | Verify build |
| `ctrack_publish_web_deploy.yml` | tag `v*` / manual | **windows-latest** | GitHub Release installers |

Web deploy: **Vercel Git integration only** (not GitHub Actions).

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
