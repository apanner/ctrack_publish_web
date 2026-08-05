import "./env.js"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import http from "node:http"
import { fileURLToPath } from "node:url"
import { exec, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { promisify } from "node:util"
import express, { type Request, type Response, type NextFunction } from "express"
import cors from "cors"
import { loadEnv } from "./env.js"
import { getEngineRoot, getInstallRoot, getUserDataDir } from "./paths.js"
import {
  SETUP_ENV_KEYS,
  getUserEnvPath,
  isSetupComplete,
  mergeUserEnvFile,
} from "./setup-config.js"
import { QueueManager, type DBJob, type DBJobEventInput } from "./queue-manager.js"
import { S3Manager } from "./s3-manager.js"
import { PythonManager } from "./python-manager.js"
import { getVideoMetadata } from "./video-metadata.js"
import { processPathsOrFolders, processFilePathsOnly } from "./staging.js"
import { engineBus } from "./event-bus.js"
import { fetchEngineStatus } from "./runtime-status.js"
import { getSettingsBundle, patchSettingsBundle } from "./settings-bundle.js"
import { enqueuePublishJob, headlessProcessJob, headlessProcessNextIdleJob, validateEnqueueBody } from "./publish-api.js"
import { addJobAndEmit, deleteJobAndEmit, updateJobAndEmit } from "./queue-events.js"
import { dispatchJobAsync } from "./publish-worker.js"
import { ensureMediaRuntime } from "./runtime-ensure.js"
import {
  getUserTemplatesRoot,
  getTemplateAbsolutePathById,
  getTemplateById,
  importTemplate,
  listTemplates,
  seedDefaultReviewTemplateIfEmpty,
  syncTemplatesDirectories,
  upsertTemplateMetadata,
} from "./template-registry.js"
import { getAuthSnapshot, getAuthStatus, getAuthStorePath, getCredentialsPath, pairDevice, refreshDeviceToken, syncAccountEmail, unpairDevice } from "./auth-store.js"
import { getLocalAuthLinkUrl, pairFromAccessToken, renderAuthLinkPage, resolveSupabaseJsPath } from "./auth-link-page.js"
import { applyDownloadedUpdate, checkForUpdate, downloadUpdate, getPendingUpdate, type UpdateProduct } from "./update-service.js"
import { migratePlainCredentialsToDpapi } from "./credentials-dpapi.js"
import { ENGINE_VERSION } from "./generated/engine-version.js"

const execAsync = promisify(exec)
const SERVICE_NAME = "ctrack-engine"

function getWindowsPowerShellExe(): string {
  const root = process.env.SystemRoot ?? "C:\\Windows"
  return path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
}

function runWindowsFolderPickerScript(ps1File: string, outFileArg: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const exe = getWindowsPowerShellExe()
    const stderrChunks: Buffer[] = []
    const stdoutChunks: Buffer[] = []
    const child = spawn(
      exe,
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", ps1File, outFileArg],
      {
        windowsHide: false,
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    child.stdout?.on("data", (d: Buffer) => {
      stdoutChunks.push(d)
    })
    child.stderr?.on("data", (d: Buffer) => {
      stderrChunks.push(d)
    })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      const errText = Buffer.concat(stderrChunks).toString("utf8").trim()
      const outText = Buffer.concat(stdoutChunks).toString("utf8").trim()
      const detail = [errText, outText].filter(Boolean).join(" — ")
      if (signal) {
        reject(new Error(`Folder picker interrupted (${signal})${detail ? `: ${detail}` : ""}`))
        return
      }
      if (code !== 0) {
        reject(
          new Error(
            detail.length > 0
              ? `Folder picker failed (exit ${code}): ${detail}`
              : `Folder picker exited with code ${code} (no output — check engine terminal or run the engine in an interactive desktop session)`
          )
        )
        return
      }
      resolve()
    })
  })
}

const PORT = Number(process.env.CTRACK_ENGINE_PORT || 7777)
const HOST = process.env.CTRACK_ENGINE_HOST || "127.0.0.1"

const SETTINGS_PATH = path.join(getUserDataDir(), "settings.json")
const STAGING_PATH = path.join(getUserDataDir(), "staging.json")

const queueManager = new QueueManager()
let s3Manager = new S3Manager()
const pythonManager = new PythonManager()

function resolveGuiPythonExe(installRoot: string): string {
  const candidates = [
    path.join(installRoot, "runtime", "python", "pythonw.exe"),
    path.join(installRoot, "engine", "runtime", "python", "pythonw.exe"),
    path.join(installRoot, "runtime", "python", "python.exe"),
    path.join(installRoot, "engine", "runtime", "python", "python.exe"),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return "pythonw"
}

function resolveVbsLauncher(installRoot: string, fileName: string): string | null {
  const candidates = [
    path.join(installRoot, fileName),
    path.join(installRoot, "scripts", fileName),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function refreshManagersAfterEnvSave(): void {
  for (const key of SETUP_ENV_KEYS) {
    delete process.env[key]
  }
  loadEnv()
  s3Manager = new S3Manager()
}

function safeTrimEnv(value: string | undefined, fallback = ""): string {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : fallback
}

function tailTextFile(filePath: string, lineLimit: number): string[] {
  if (!fs.existsSync(filePath)) {
    return []
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
    if (lines.length === 0) return []
    return lines.slice(-lineLimit)
  } catch {
    return []
  }
}

function collectRecentQueueLogTail(lineLimit: number): string[] {
  const jobs = queueManager.getJobs(8)
  const lines: Array<{ createdAt: string; message: string }> = []
  for (const job of jobs) {
    const events = queueManager.getJobEvents(job.id, 6)
    for (const event of events) {
      const summary = `[${event.created_at}] ${event.level.toUpperCase()} ${event.component}/${event.event_type} (${event.job_id}): ${event.message}`
      lines.push({ createdAt: event.created_at, message: summary })
    }
  }
  lines.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  return lines.slice(0, lineLimit).map((entry) => entry.message)
}

function collectRecentLogsTail(lineLimit: number): string[] {
  const userDataDir = getUserDataDir()
  const candidateFiles = ["engine.log", "tray.log", "server.log", "ctrack-engine.log"].map((name) =>
    path.join(userDataDir, name)
  )
  const fromFiles: string[] = []
  for (const filePath of candidateFiles) {
    const tailed = tailTextFile(filePath, Math.max(3, Math.floor(lineLimit / candidateFiles.length)))
    if (tailed.length === 0) continue
    fromFiles.push(...tailed.map((line) => `[${path.basename(filePath)}] ${line}`))
  }
  const fromQueue = collectRecentQueueLogTail(lineLimit)
  const combined = [...fromFiles, ...fromQueue]
  if (combined.length === 0) {
    return ["No local log files or recent queue events found."]
  }
  return combined.slice(-lineLimit)
}

pythonManager.on("python-log", (msg: string) => {
  engineBus.emit("python-log", msg)
})

function wrapAddJobEvent(payload: DBJobEventInput) {
  const row = queueManager.addJobEvent(payload)
  engineBus.emit("queue:log-appended", row)
  return row
}

const publishApiDeps = {
  queueManager,
  pythonManager,
  onQueueEvent: (event: unknown) => {
    engineBus.emit("queue:log-appended", event)
  },
}

const publishWorkerDeps = {
  queueManager,
  pythonManager,
  s3Manager,
  onQueueEvent: publishApiDeps.onQueueEvent,
}

function parseCorsOrigins(): string[] {
  const raw = process.env.CTRACK_WEB_ORIGINS
  if (raw) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean)
  }
  return [
    "http://localhost:5173",
    "http://localhost:3001",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3001",
    `http://127.0.0.1:${PORT}`,
    `http://localhost:${PORT}`,
    "https://ctrackpublishweb.vercel.app",
  ]
}

function resolveWebDistDir(): string | null {
  const candidates = [
    path.join(getInstallRoot(), "web", "dist"),
    path.join(getEngineRoot(), "..", "web", "dist"),
    path.join(getEngineRoot(), "web", "dist"),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return path.resolve(dir)
  }
  return null
}

/** Serve packaged React UI from the engine (same-origin → no Chrome PNA). */
function mountLocalWebUi(): void {
  const webDist = resolveWebDistDir()
  if (!webDist) {
    console.warn("[ctrack-engine] Local web UI not found (web/dist). Tray will fall back to hosted URL.")
    return
  }
  console.log(`[ctrack-engine] Serving local UI from ${webDist}`)
  app.use(express.static(webDist, { index: "index.html", fallthrough: true }))
  app.get("*", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next()
      return
    }
    const p = req.path || ""
    if (
      p.startsWith("/api") ||
      p.startsWith("/auth") ||
      p === "/health" ||
      p.startsWith("/health?")
    ) {
      next()
      return
    }
    if (path.extname(p)) {
      next()
      return
    }
    res.sendFile(path.join(webDist, "index.html"), (err) => {
      if (err) next(err)
    })
  })
}

const app = express()
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Private-Network", "true")
  next()
})
app.use(
  cors({
    origin: parseCorsOrigins(),
    credentials: true,
  })
)
app.use(express.json({ limit: "50mb" }))

app.get("/api", (_req, res) => {
  res.json({
    service: SERVICE_NAME,
    version: ENGINE_VERSION,
    routes: [
      { method: "GET", path: "/health" },
      { method: "GET", path: "/api" },
      { method: "GET", path: "/api/setup/status" },
      { method: "GET", path: "/api/setup/runtime-config" },
      { method: "POST", path: "/api/setup/save", localhostOnly: true },
      { method: "POST", path: "/api/auth/pair", localhostOnly: true },
      { method: "GET", path: "/api/auth/pair-redirect", localhostOnly: true },
      { method: "POST", path: "/api/auth/unpair", localhostOnly: true },
      { method: "GET", path: "/api/auth/login-url", localhostOnly: true },
      { method: "GET", path: "/api/auth/status", localhostOnly: true },
      { method: "POST", path: "/api/auth/refresh", localhostOnly: true },
      { method: "GET", path: "/api/diagnostics/export", localhostOnly: true },
      { method: "GET", path: "/api/logs/tail", localhostOnly: true },
      { method: "GET", path: "/api/engine/status" },
      { method: "POST", path: "/api/engine/rescan", localhostOnly: true },
      { method: "GET", path: "/api/engine/settings" },
      { method: "PATCH", path: "/api/engine/settings", localhostOnly: true },
      { method: "GET", path: "/api/update/check", localhostOnly: true },
      { method: "POST", path: "/api/update/download", localhostOnly: true, paired: true },
      { method: "POST", path: "/api/update/apply", localhostOnly: true, paired: true },
      { method: "POST", path: "/api/gui/open", localhostOnly: true },
      { method: "GET", path: "/api/templates" },
      { method: "GET", path: "/api/templates/:id" },
      { method: "PUT", path: "/api/templates/:id", localhostOnly: true },
      { method: "POST", path: "/api/templates/import", localhostOnly: true },
      { method: "POST", path: "/api/templates/push", localhostOnly: true },
      { method: "POST", path: "/api/publish/enqueue", localhostOnly: true },
      { method: "GET", path: "/api/publish/jobs" },
      { method: "GET", path: "/api/publish/jobs/:id" },
      { method: "POST", path: "/api/publish/jobs/:id/process", localhostOnly: true },
      { method: "POST", path: "/api/publish/process-next", localhostOnly: true },
      { method: "POST", path: "/api/publish/dispatch", localhostOnly: true },
      { method: "POST", path: "/api/runtime/ensure", localhostOnly: true },
      { method: "GET", path: "/api/stream" },
      { method: "POST", path: "/api/ipc" },
    ],
  })
})

function localhostSetupOnly(req: Request, res: Response, next: NextFunction): void {
  const raw = req.socket.remoteAddress ?? ""
  const ok =
    raw === "127.0.0.1" ||
    raw === "::1" ||
    raw === "::ffff:127.0.0.1" ||
    raw.endsWith("127.0.0.1")
  if (!ok) {
    res.status(403).json({ error: "Setup routes are only allowed from localhost" })
    return
  }
  next()
}

function localhostOnly(req: Request, res: Response, next: NextFunction): void {
  const raw = req.socket.remoteAddress ?? ""
  const ok =
    raw === "127.0.0.1" ||
    raw === "::1" ||
    raw === "::ffff:127.0.0.1" ||
    raw.endsWith("127.0.0.1")
  if (!ok) {
    res.status(403).json({ error: "This route is only allowed from localhost" })
    return
  }
  next()
}

function requirePaired(_req: Request, res: Response, next: NextFunction): void {
  const auth = getAuthSnapshot()
  if (!auth.paired) {
    res.status(403).json({ ok: false, error: "Engine is not paired. Link this workstation first." })
    return
  }
  next()
}

app.get("/api/setup/status", (_req, res) => {
  res.json({
    complete: isSetupComplete(),
    userEnvPath: getUserEnvPath(),
  })
})

app.get("/api/setup/runtime-config", (_req, res) => {
  res.json({
    supabaseUrl: process.env.VITE_SUPABASE_URL?.trim() ?? "",
    supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "",
  })
})

app.post("/api/setup/save", localhostSetupOnly, (req, res) => {
  try {
    const body = req.body as Record<string, unknown>
    if (!body || typeof body !== "object") {
      res.status(400).json({ error: "Invalid JSON body" })
      return
    }
    const flat: Record<string, string> = {}
    for (const [k, v] of Object.entries(body)) {
      flat[k] = typeof v === "string" ? v : String(v ?? "")
    }
    mergeUserEnvFile(flat)
    refreshManagersAfterEnvSave()
    res.json({ ok: true, complete: isSetupComplete() })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ error: message })
  }
})

app.post("/api/auth/pair", localhostOnly, async (req, res) => {
  try {
    const pairToken = String(req.body?.pairToken ?? req.body?.pair_token ?? "").trim()
    if (!pairToken) {
      res.status(400).json({ ok: false, error: "pairToken is required" })
      return
    }
    const status = await pairDevice(pairToken)
    res.json({ ok: true, ...status })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

function renderPairRedirectPage(ok: boolean, title: string, message: string): string {
  const accent = ok ? "#24E1B1" : "#E85D5D"
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CTrack Engine — ${title}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #0B1118; color: #E8EEF5; font-family: "Segoe UI", system-ui, sans-serif; }
    .card { max-width: 420px; padding: 32px; text-align: center; }
    h1 { color: ${accent}; font-size: 1.5rem; margin: 0 0 12px; }
    p { color: #8FA0B3; line-height: 1.5; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`
}

app.get("/api/auth/pair-redirect", localhostOnly, async (req, res) => {
  const pairToken = String(req.query.pairToken ?? req.query.pair_token ?? "").trim()
  if (!pairToken) {
    res
      .status(400)
      .send(renderPairRedirectPage(false, "Link failed", "Missing pair token. Return to CTrack and click Sign in again."))
    return
  }
  try {
    await pairDevice(pairToken)
    res.send(
      renderPairRedirectPage(
        true,
        "Engine linked",
        "This workstation is connected. Close this tab — the CTrack sign-in window will finish automatically."
      )
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).send(renderPairRedirectPage(false, "Link failed", message))
  }
})

app.post("/api/auth/unpair", localhostOnly, (_req, res) => {
  try {
    const status = unpairDevice()
    res.json({ ok: true, ...status })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.get("/api/auth/status", localhostOnly, async (_req, res) => {
  let auth = getAuthStatus()
  if (auth.paired && !auth.email) {
    try {
      auth = await syncAccountEmail()
    } catch {
      // Keep status without email if sync fails.
    }
  }
  res.json({
    ok: true,
    paired: auth.paired,
    ready: auth.paired,
    userId: auth.userId,
    email: auth.email,
    deviceId: auth.deviceId,
    pairedAt: auth.pairedAt,
    lastRefreshAt: auth.lastRefreshAt,
  })
})

app.get("/api/auth/login-url", localhostOnly, (_req, res) => {
  const localLink = getLocalAuthLinkUrl()
  res.json({
    ok: true,
    url: localLink,
    webBase: safeTrimEnv(process.env.CTRACK_WEB_URL, "https://ctrackpublishweb.vercel.app").replace(/\/+$/, ""),
    source: "local",
  })
})

app.get("/auth/link", (_req, res) => {
  res.type("html").send(renderAuthLinkPage())
})

app.get("/auth/supabase.js", (_req, res) => {
  try {
    res.type("application/javascript").send(fs.readFileSync(resolveSupabaseJsPath()))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).type("text/plain").send(message)
  }
})

app.get("/auth/link/start", (_req, res) => {
  res.redirect(302, getLocalAuthLinkUrl())
})

app.get("/auth/callback", (req, res) => {
  const query = new URLSearchParams(req.query as Record<string, string>).toString()
  const target = query ? `${getLocalAuthLinkUrl()}?${query}` : getLocalAuthLinkUrl()
  res.redirect(302, target)
})

app.post("/api/auth/pair-from-session", localhostOnly, async (req, res) => {
  try {
    const accessToken = String(req.body?.accessToken ?? req.body?.access_token ?? "").trim()
    if (!accessToken) {
      res.status(400).json({ ok: false, error: "accessToken is required" })
      return
    }
    const emailHint = String(req.body?.email ?? "").trim() || null
    const result = await pairFromAccessToken(accessToken, emailHint)
    let auth = getAuthStatus()
    if (auth.paired && !auth.email) {
      try {
        auth = await syncAccountEmail()
      } catch {
        // Ignore sync errors; pairing already succeeded.
      }
    }
    res.json({ ok: true, ...auth, email: auth.email ?? result.email })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.post("/api/auth/refresh", localhostOnly, async (_req, res) => {
  try {
    const status = await refreshDeviceToken()
    res.json({ ok: true, ...status })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.get("/api/logs/tail", localhostOnly, (req, res) => {
  try {
    const requested = Number(req.query.limit ?? 200)
    const limit = Number.isFinite(requested) ? Math.max(10, Math.min(500, Math.floor(requested))) : 200
    res.json({ ok: true, lines: collectRecentLogsTail(limit) })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.get("/api/diagnostics/export", localhostOnly, (_req, res) => {
  try {
    const auth = getAuthStatus()
    const userDataDir = getUserDataDir()
    const installRoot = getInstallRoot()
    const pendingUpdate = getPendingUpdate()
    const diagnostics = {
      generatedAt: new Date().toISOString(),
      version: ENGINE_VERSION,
      auth: {
        paired: auth.paired,
        userId: auth.userId,
        email: auth.email,
        deviceId: auth.deviceId,
        pairedAt: auth.pairedAt,
        lastRefreshAt: auth.lastRefreshAt,
      },
      updateChannel: safeTrimEnv(process.env.CTRACK_UPDATE_CHANNEL, "stable"),
      paths: {
        userDataDir,
        engineRoot: getEngineRoot(),
        installRoot,
        settingsPath: SETTINGS_PATH,
        stagingPath: STAGING_PATH,
        authStorePath: getAuthStorePath(),
        pendingUpdateInstallerPath: pendingUpdate?.installerPath ?? null,
        userEnvPath: getUserEnvPath(),
      },
      cors: {
        allowedOrigins: parseCorsOrigins(),
        allowPrivateNetworkHeader: true,
      },
      recentLogsTail: collectRecentLogsTail(40),
    }
    res.json({ ok: true, diagnostics })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.get("/api/storage/test", async (_req, res) => {
  try {
    const report = await s3Manager.testStorageConnections()
    res.json({ ok: true, ...report })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.get("/health", (_req, res) => {
  const engineRoot = getEngineRoot()
  const auth = getAuthStatus()
  const pythonReady = pythonManager.isSidecarRunning()
  const setupComplete = isSetupComplete()
  res.json({
    status: pythonReady ? "ok" : "degraded",
    service: SERVICE_NAME,
    version: ENGINE_VERSION,
    pythonReady,
    platform: process.platform,
    engineRoot,
    setupComplete,
    paired: auth.paired,
    ready: setupComplete && pythonReady,
    email: auth.email,
  })
})

app.get("/api/engine/status", async (_req, res) => {
  try {
    const data = await fetchEngineStatus(pythonManager)
    res.json({ ok: true, ...data })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.post("/api/engine/rescan", localhostSetupOnly, async (_req, res) => {
  try {
    const data = await fetchEngineStatus(pythonManager, { rescan: true })
    res.json({ ok: true, ...data })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.get("/api/engine/settings", async (_req, res) => {
  try {
    const bundle = await getSettingsBundle(pythonManager)
    res.json({ ok: true, ...bundle })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.patch("/api/engine/settings", localhostSetupOnly, async (req, res) => {
  try {
    const body = req.body as { engine?: Record<string, unknown>; tray?: Record<string, unknown> }
    if (!body || typeof body !== "object") {
      res.status(400).json({ ok: false, error: "Invalid JSON body" })
      return
    }
    const bundle = await patchSettingsBundle(pythonManager, body)
    res.json({ ok: true, ...bundle })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.get("/api/update/check", localhostOnly, async (req, res) => {
  try {
    const rawProduct = String(req.query.product ?? "engine").trim().toLowerCase()
    const product: UpdateProduct = rawProduct === "nuke" ? "nuke" : "engine"
    const rawLocalVersion = String(req.query.localVersion ?? "").trim()
    const localVersion = rawLocalVersion || (product === "nuke" ? "0.0.0" : ENGINE_VERSION)
    const includeDownloadUrl = req.query.includeDownloadUrl != null ? String(req.query.includeDownloadUrl) !== "false" : product === "nuke"
    const check = await checkForUpdate(localVersion, {
      product,
      includeDownloadUrl,
    })
    const responseBody: Record<string, unknown> = {
      ...check,
      paired: getAuthSnapshot().paired,
    }
    if (product === "engine") {
      responseBody.pendingUpdate = getPendingUpdate()
    }
    res.json(responseBody)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const rawProduct = String(req.query.product ?? "engine").trim().toLowerCase()
    res.status(500).json({ ok: false, error: message, product: rawProduct === "nuke" ? "nuke" : "engine" })
  }
})

app.post("/api/update/download", localhostOnly, requirePaired, async (_req, res) => {
  try {
    const result = await downloadUpdate(ENGINE_VERSION)
    res.json({
      ...result,
      paired: true,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message, localVersion: ENGINE_VERSION })
  }
})

app.post("/api/update/apply", localhostOnly, requirePaired, async (_req, res) => {
  try {
    const result = await applyDownloadedUpdate()
    res.json({
      ...result,
      pendingUpdate: getPendingUpdate(),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.post("/api/gui/open", localhostSetupOnly, (req, res) => {
  try {
    if (process.platform !== "win32") {
      res.status(400).json({ ok: false, error: "GUI open is only supported on Windows hosts" })
      return
    }
    const panel = req.body?.panel
    if (panel !== "settings" && panel !== "tray" && panel !== "logs") {
      res.status(400).json({ ok: false, error: "Invalid panel. Expected 'settings', 'logs', or 'tray'" })
      return
    }

    const installRoot = getInstallRoot()
    if (panel === "logs") {
      const pythonExe = resolveGuiPythonExe(installRoot)
      const child = spawn(
        pythonExe,
        ["-m", "gui.engine_window", "--install-root", installRoot],
        {
          cwd: path.join(getEngineRoot(), "python"),
          windowsHide: true,
          detached: true,
          stdio: "ignore",
        }
      )
      child.unref()
      res.json({ ok: true, panel, launcher: "pythonw -m gui.engine_window" })
      return
    }
    if (panel === "settings") {
      const launcher = resolveVbsLauncher(installRoot, "open-tray-settings.vbs")
      if (!launcher) {
        res.status(500).json({ ok: false, error: "Missing launcher: open-tray-settings.vbs" })
        return
      }
      const child = spawn("wscript.exe", ["//nologo", launcher], {
        cwd: path.dirname(launcher),
        windowsHide: true,
        detached: true,
        stdio: "ignore",
      })
      child.unref()
      res.json({ ok: true, panel, launcher: path.basename(launcher) })
      return
    }

    const trayLauncher = resolveVbsLauncher(installRoot, "start-engine-tray.vbs")
    if (trayLauncher) {
      const child = spawn("wscript.exe", ["//nologo", trayLauncher], {
        cwd: path.dirname(trayLauncher),
        windowsHide: true,
        detached: true,
        stdio: "ignore",
      })
      child.unref()
      res.json({ ok: true, panel, launcher: path.basename(trayLauncher) })
      return
    }

    const pythonExe = resolveGuiPythonExe(installRoot)
    const child = spawn(pythonExe, ["-m", "gui", "--install-root", installRoot], {
      cwd: path.join(getEngineRoot(), "python"),
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    })
    child.unref()
    res.json({ ok: true, panel, launcher: "pythonw -m gui" })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.get("/api/templates", (_req, res) => {
  try {
    const templates = listTemplates().map((template) => ({
      ...template,
      path: getTemplateAbsolutePathById(template.id),
    }))
    res.json({ ok: true, templates })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.get("/api/templates/:id", (req, res) => {
  try {
    const template = getTemplateById(req.params.id)
    if (!template) {
      res.status(404).json({ ok: false, error: "Template not found" })
      return
    }
    res.json({
      ok: true,
      template: {
        ...template,
        path: getTemplateAbsolutePathById(template.id),
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.put("/api/templates/:id", localhostSetupOnly, (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      name?: string
      category?: string
      relativePath?: string
      description?: string | null
    }
    if (!body || typeof body !== "object") {
      res.status(400).json({ ok: false, error: "Invalid JSON body" })
      return
    }
    const template = upsertTemplateMetadata(req.params.id, body)
    res.json({
      ok: true,
      template: {
        ...template,
        path: getTemplateAbsolutePathById(template.id),
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(400).json({ ok: false, error: message })
  }
})

app.post("/api/templates/import", localhostSetupOnly, (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      sourcePath?: string
      fileName?: string
      fileContentBase64?: string
      id?: string
      name?: string
      category?: string
      description?: string | null
    }
    const template = importTemplate(body)
    res.json({
      ok: true,
      template: {
        ...template,
        path: getTemplateAbsolutePathById(template.id),
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(400).json({ ok: false, error: message })
  }
})

app.post("/api/templates/push", localhostSetupOnly, (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      targetDir?: string
      sourceDir?: string
      mode?: "pull" | "push"
    }
    const userTemplatesRoot = getUserTemplatesRoot()
    if (typeof body.targetDir === "string" && body.targetDir.trim().length > 0) {
      const result = syncTemplatesDirectories(userTemplatesRoot, body.targetDir.trim())
      res.json({ ok: true, mode: "push", ...result })
      return
    }
    const sourceDir = typeof body.sourceDir === "string" ? body.sourceDir.trim() : ""
    const mode = body.mode
    if (sourceDir.length === 0 || (mode !== "pull" && mode !== "push")) {
      res.status(400).json({
        ok: false,
        error:
          "Invalid body. Provide { targetDir: string } for push, or { sourceDir: string, mode: 'pull' | 'push' } for explicit sync.",
      })
      return
    }
    const syncSource = mode === "pull" ? sourceDir : userTemplatesRoot
    const syncTarget = mode === "pull" ? userTemplatesRoot : sourceDir
    const result = syncTemplatesDirectories(syncSource, syncTarget)
    res.json({ ok: true, mode, ...result })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(400).json({ ok: false, error: message })
  }
})

app.post("/api/publish/enqueue", localhostSetupOnly, async (req, res) => {
  try {
    const body = validateEnqueueBody(req.body)
    const job = enqueuePublishJob(body, publishApiDeps)
    if (!body.auto_process) {
      res.status(201).json({ ok: true, job })
      return
    }
    dispatchJobAsync(job.id, publishWorkerDeps)
    res.status(201).json({ ok: true, job, dispatched: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const statusCode = /invalid|required/i.test(message) ? 400 : 500
    res.status(statusCode).json({ ok: false, error: message })
  }
})

app.get("/api/publish/jobs", (req, res) => {
  try {
    const requested = Number(req.query.limit ?? 200)
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(1000, Math.floor(requested))) : 200
    const jobs = queueManager.getJobs(limit)
    res.json({ ok: true, jobs })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.get("/api/publish/jobs/:id", (req, res) => {
  try {
    const id = String(req.params.id ?? "")
    const job = queueManager.getJob(id)
    if (!job) {
      res.status(404).json({ ok: false, error: "Job not found" })
      return
    }
    const logs = queueManager.getJobEvents(id, 1000)
    res.json({ ok: true, job, logs })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.post("/api/publish/jobs/:id/process", localhostSetupOnly, async (req, res) => {
  try {
    const id = String(req.params.id ?? "")
    if (!id) {
      res.status(400).json({ ok: false, error: "Job id is required" })
      return
    }
    dispatchJobAsync(id, publishWorkerDeps)
    const job = queueManager.getJob(id)
    res.json({ ok: true, job, dispatched: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const statusCode = /not found/i.test(message) ? 404 : 500
    res.status(statusCode).json({ ok: false, error: message })
  }
})

app.post("/api/publish/dispatch", localhostSetupOnly, async (req, res) => {
  try {
    const id = String((req.body as { jobId?: string })?.jobId ?? "")
    if (!id) {
      res.status(400).json({ ok: false, error: "jobId is required" })
      return
    }
    const job = queueManager.getJob(id)
    if (!job) {
      res.status(404).json({ ok: false, error: "Job not found" })
      return
    }
    dispatchJobAsync(id, publishWorkerDeps)
    res.json({ ok: true, job, dispatched: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.post("/api/runtime/ensure", localhostSetupOnly, async (_req, res) => {
  try {
    const result = await ensureMediaRuntime(getInstallRoot())
    res.json({ ok: true, ...result })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.post("/api/publish/process-next", localhostSetupOnly, async (_req, res) => {
  try {
    const processed = await headlessProcessNextIdleJob(publishApiDeps)
    if (!processed) {
      res.json({ ok: true, processed: false, message: "No idle jobs available" })
      return
    }
    res.json({ ok: true, processed: true, job: processed.job, output_path: processed.output_path })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(500).json({ ok: false, error: message })
  }
})

app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.flushHeaders()

  const send = (event: string, data: unknown) => {
    res.write(`event:${event}\ndata:${JSON.stringify(data)}\n\n`)
  }

  const onPy = (msg: string) => send("python-log", msg)
  const onUp = (d: unknown) => send("upload-progress", d)
  const onQueue = (d: unknown) => send("queue-log", d)
  const onJobAdded = (d: unknown) => send("queue:job-added", d)
  const onJobUpdated = (d: unknown) => send("queue:job-updated", d)
  const onJobRemoved = (d: unknown) => send("queue:job-removed", d)

  engineBus.on("python-log", onPy)
  engineBus.on("upload-progress", onUp)
  engineBus.on("queue:log-appended", onQueue)
  engineBus.on("queue:job-added", onJobAdded)
  engineBus.on("queue:job-updated", onJobUpdated)
  engineBus.on("queue:job-removed", onJobRemoved)

  send("connected", {})
  const ping = setInterval(() => send("ping", {}), 25000)

  req.on("close", () => {
    clearInterval(ping)
    engineBus.off("python-log", onPy)
    engineBus.off("upload-progress", onUp)
    engineBus.off("queue:log-appended", onQueue)
    engineBus.off("queue:job-added", onJobAdded)
    engineBus.off("queue:job-updated", onJobUpdated)
    engineBus.off("queue:job-removed", onJobRemoved)
  })
})

app.post("/api/ipc", async (req, res) => {
  const channel = req.body?.channel as string
  const payload = req.body?.payload as unknown

  if (typeof channel !== "string" || channel.trim() === "") {
    res.status(400).json({ error: "Missing or invalid channel" })
    return
  }

  try {
    const out = await dispatchIpc(channel, payload)
    res.json(out)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[ipc]", channel, message)
    res.status(500).json({ error: message })
  }
})

/**
 * Modern Windows picker (Explorer-style) using OpenFileDialog in folder mode.
 * WinForms FolderBrowserDialog shows the classic tree UI (what users dislike).
 */
const PS1_MODERN_EXPLORER_FOLDER_PICKER = [
  "param([string]$OutPath)",
  "$ErrorActionPreference = 'Stop'",
  "try {",
  "  Add-Type -AssemblyName System.Windows.Forms | Out-Null",
  "} catch {",
  "  Write-Error \"WinForms load failed: $_\"",
  "  exit 1",
  "}",
  "$owner = $null",
  "$dlg = $null",
  "try {",
  "  [System.Windows.Forms.Application]::EnableVisualStyles()",
  "  $owner = New-Object System.Windows.Forms.Form",
  "  $owner.TopMost = $true",
  "  $owner.ShowInTaskbar = $false",
  "  $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen",
  "  $owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow",
  "  $owner.ControlBox = $false",
  "  $owner.Width = 1",
  "  $owner.Height = 1",
  "  $owner.Opacity = 0",
  "  [void]$owner.Show()",
  "  $dlg = New-Object System.Windows.Forms.OpenFileDialog",
  "  $dlg.Title = 'Select delivery folder for CTrack Publish (same folder as in the browser).'",
  "  $dlg.Filter = 'Folders|*.*'",
  "  $dlg.CheckFileExists = $false",
  "  $dlg.CheckPathExists = $true",
  "  $dlg.ValidateNames = $false",
  "  $dlg.FileName = 'Select Folder'",
  "  $dr = $dlg.ShowDialog($owner)",
  "  if ([int]$dr -eq 1) {",
  "    $picked = [System.IO.Path]::GetDirectoryName($dlg.FileName)",
  "    if (-not [string]::IsNullOrWhiteSpace($picked)) {",
  "      [System.IO.File]::WriteAllText($OutPath, $picked, [System.Text.UTF8Encoding]::new($false))",
  "    }",
  "  }",
  "} catch {",
  "  Write-Error $_",
  "  exit 1",
  "} finally {",
  "  if ($null -ne $dlg) { $dlg.Dispose() }",
  "  if ($null -ne $owner) { try { $owner.Close() } catch {}; $owner.Dispose() }",
  "}",
].join("\r\n")

const PS1_WIN_FORMS_FOLDER_PICKER = [
  "param([string]$OutPath)",
  "$ErrorActionPreference = 'Stop'",
  "try {",
  "  Add-Type -AssemblyName System.Windows.Forms | Out-Null",
  "} catch {",
  "  Write-Error \"WinForms load failed: $_\"",
  "  exit 1",
  "}",
  "$owner = $null",
  "$fb = $null",
  "try {",
  "  $owner = New-Object System.Windows.Forms.Form",
  "  $owner.TopMost = $true",
  "  $owner.ShowInTaskbar = $false",
  "  $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen",
  "  $owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow",
  "  $owner.ControlBox = $false",
  "  $owner.Width = 1",
  "  $owner.Height = 1",
  "  $owner.Opacity = 0",
  "  [void]$owner.Show()",
  "  $fb = New-Object System.Windows.Forms.FolderBrowserDialog",
  "  $fb.Description = 'Select delivery folder for CTrack Publish (same folder as in the browser).'",
  "  $fb.ShowNewFolderButton = $false",
  "  $dr = $fb.ShowDialog($owner)",
  "  if ([int]$dr -eq 1 -and $fb.SelectedPath) {",
  "    [System.IO.File]::WriteAllText($OutPath, $fb.SelectedPath, [System.Text.UTF8Encoding]::new($false))",
  "  }",
  "} catch {",
  "  Write-Error $_",
  "  exit 1",
  "} finally {",
  "  if ($null -ne $fb) { $fb.Dispose() }",
  "  if ($null -ne $owner) { try { $owner.Close() } catch {}; $owner.Dispose() }",
  "}",
].join("\r\n")

/** Fallback when WinForms fails on some hosts (older .NET, policy). Flag 64 = BIF_NEWDIALOGSTYLE (modern tree UI). */
const PS1_SHELL_BROWSE_FOLDER_PICKER = [
  "param([string]$OutPath)",
  "$ErrorActionPreference = 'Stop'",
  "try {",
  "  $sh = New-Object -ComObject Shell.Application",
  "  $f = $sh.BrowseForFolder(0, 'Select delivery folder for CTrack Publish', 64)",
  "  if ($null -ne $f -and $null -ne $f.Self) {",
  "    [System.IO.File]::WriteAllText($OutPath, $f.Self.Path, [System.Text.UTF8Encoding]::new($false))",
  "  }",
  "} catch {",
  "  Write-Error $_",
  "  exit 1",
  "}",
].join("\r\n")

async function runWindowsFolderPickerScriptContent(scriptBody: string): Promise<string | null> {
  const id = randomBytes(8).toString("hex")
  const outFile = path.join(os.tmpdir(), `ctrack-folder-out-${id}.txt`)
  const ps1File = path.join(os.tmpdir(), `ctrack-folder-${id}.ps1`)
  try {
    fs.writeFileSync(ps1File, `${scriptBody}\r\n`, { encoding: "utf8" })
    await runWindowsFolderPickerScript(ps1File, outFile)
    if (!fs.existsSync(outFile)) return null
    const selectedPath = fs.readFileSync(outFile, "utf8").trim().replace(/\r?\n/g, "")
    return selectedPath || null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const err = e as { stderr?: unknown }
    const stderr =
      typeof err.stderr === "string" && err.stderr.trim().length > 0 ? err.stderr.trim() : ""
    console.error("[folder-picker]", stderr || msg)
    throw new Error(stderr || msg || "Folder picker failed")
  } finally {
    for (const fp of [ps1File, outFile]) {
      try {
        if (fs.existsSync(fp)) fs.unlinkSync(fp)
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Windows folder picker order:
 * 1) Modern Explorer-style dialog (preferred UX)
 * 2) WinForms FolderBrowserDialog
 * 3) Shell.Application BrowseForFolder fallback
 */
async function selectDirectoryWithSystemDialog(): Promise<string | null> {
  if (process.platform !== "win32") return null
  try {
    return await runWindowsFolderPickerScriptContent(PS1_MODERN_EXPLORER_FOLDER_PICKER)
  } catch (e) {
    console.warn("[ctrack-engine] Modern explorer folder dialog failed; trying WinForms", e)
    try {
      return await runWindowsFolderPickerScriptContent(PS1_WIN_FORMS_FOLDER_PICKER)
    } catch (e2) {
      console.warn("[ctrack-engine] WinForms folder dialog failed; trying Shell.Application", e2)
      return await runWindowsFolderPickerScriptContent(PS1_SHELL_BROWSE_FOLDER_PICKER)
    }
  }
}

async function dispatchIpc(channel: string, payload: unknown): Promise<unknown> {
  switch (channel) {
    case "python-command": {
      const body = payload as { command: string; params?: Record<string, unknown> }
      return await pythonManager.sendCommand(body.command, body.params ?? {})
    }
    case "python:install-deps": {
      const body = payload as { modules: string[] }
      const pythonExe = process.platform === "win32" ? "python" : "python3"
      const { stdout, stderr } = await execAsync(`${pythonExe} -m pip install ${body.modules.join(" ")}`)
      return stdout || stderr
    }
    case "upload-s3": {
      const body = payload as { filePath: string; bucketName: string; key: string }
      const provider = s3Manager.getStorageProvider()
      const onProgress = (progress: number) => {
        engineBus.emit("upload-progress", { key: body.key, progress })
      }
      if (provider === "hybrid") {
        return await s3Manager.uploadFileHybrid(body.filePath, body.bucketName, body.key, onProgress)
      }
      return await s3Manager.uploadFile(body.filePath, body.bucketName, body.key, onProgress)
    }
    case "select-directory":
      console.log("[ctrack-engine] select-directory: opening native folder picker (HTTP request blocks until you pick or cancel)")
      return await selectDirectoryWithSystemDialog()
    case "dialog:open-files":
      return []
    case "dialog:open-folder-files": {
      console.log(
        "[ctrack-engine] dialog:open-folder-files: opening native folder picker (HTTP request blocks until you pick or cancel)"
      )
      if (process.platform !== "win32") {
        return {
          items: [],
          unsupported: [],
          selectedPath: null,
          nativeFolderPickerAvailable: false,
        }
      }
      const selectedPath = await selectDirectoryWithSystemDialog()
      if (!selectedPath) {
        return {
          items: [],
          unsupported: [],
          selectedPath: null,
          nativeFolderPickerAvailable: true,
        }
      }
      return {
        ...processPathsOrFolders([selectedPath]),
        selectedPath,
        nativeFolderPickerAvailable: true,
      }
    }
    case "queue:get-jobs":
      return queueManager.getJobs()
    case "queue:add-job": {
      addJobAndEmit(queueManager, payload as DBJob)
      return true
    }
    case "queue:update-job": {
      const body = payload as { id: string; updates: Partial<DBJob> }
      updateJobAndEmit(queueManager, body.id, body.updates)
      return true
    }
    case "queue:remove-job":
      deleteJobAndEmit(queueManager, String(payload))
      return true
    case "queue:dispatch-job": {
      const body = payload as { jobId?: string }
      const jobId = String(body?.jobId ?? "")
      if (!jobId) throw new Error("jobId is required")
      dispatchJobAsync(jobId, publishWorkerDeps)
      return { ok: true, dispatched: true }
    }
    case "queue:clear":
      queueManager.clearCompleted()
      return true
    case "queue:purge":
      queueManager.deleteAllJobs()
      return true
    case "queue:add-log": {
      const body = payload as { jobId: string; message: string }
      return wrapAddJobEvent({
        job_id: body.jobId,
        message: body.message,
        component: "renderer",
        event_type: "log",
      })
    }
    case "queue:add-event":
      return wrapAddJobEvent(payload as DBJobEventInput)
    case "queue:get-logs":
      return queueManager.getJobLogs(String(payload))
    case "queue:get-events": {
      const body = payload as { jobId: string; limit?: number }
      return queueManager.getJobEvents(body.jobId, body.limit ?? 1000)
    }
    case "staging:read": {
      try {
        const raw = fs.readFileSync(STAGING_PATH, "utf-8")
        return JSON.parse(raw)
      } catch {
        return { items: [], formData: null }
      }
    }
    case "staging:write": {
      fs.writeFileSync(STAGING_PATH, JSON.stringify(payload, null, 2), "utf-8")
      return true
    }
    case "staging:clear": {
      try {
        fs.unlinkSync(STAGING_PATH)
      } catch {
        /* ignore */
      }
      return true
    }
    case "staging:process-files": {
      const body = payload as { filePaths: string[] }
      return processFilePathsOnly(body.filePaths).items
    }
    case "staging:process-paths-or-folders": {
      const body = payload as { paths: string[] }
      return processPathsOrFolders(body.paths)
    }
    case "settings:read": {
      try {
        const raw = fs.readFileSync(SETTINGS_PATH, "utf-8")
        return JSON.parse(raw)
      } catch {
        return null
      }
    }
    case "settings:write": {
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(payload, null, 2), "utf-8")
      return true
    }
    case "app:get-temp-path":
      return os.tmpdir()
    case "app:ensure-dir": {
      fs.mkdirSync(String(payload), { recursive: true })
      return payload
    }
    case "video-metadata":
      return await getVideoMetadata(String(payload))
    case "fs:delete-file": {
      try {
        const fp = String(payload)
        if (fs.existsSync(fp)) fs.unlinkSync(fp)
        return true
      } catch {
        return false
      }
    }
    case "notify":
      console.log("[notify]", payload)
      return true
    case "auth:get-pending-code":
      return null
    case "open-external-url":
      return { delegateToBrowser: true, url: String(payload) }
    case "engine:get-status":
      return fetchEngineStatus(pythonManager)
    case "engine:rescan-tools":
      return fetchEngineStatus(pythonManager, { rescan: true })
    default:
      throw new Error(`Unknown IPC channel: ${channel}`)
  }
}

let httpServer: http.Server | null = null

function isRunAsNodeMainScript(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    const selfPath = path.resolve(fileURLToPath(import.meta.url))
    const entryPath = path.resolve(entry)
    return selfPath === entryPath
  } catch {
    return false
  }
}

export function startEngine(): Promise<http.Server> {
  pythonManager.start()
  seedDefaultReviewTemplateIfEmpty()
  mountLocalWebUi()
  void migratePlainCredentialsToDpapi(getCredentialsPath()).catch((e) => {
    console.warn("[ctrack-engine] credentials DPAPI migration skipped:", e)
  })
  return new Promise((resolve, reject) => {
    try {
      httpServer = app.listen(PORT, HOST, () => {
        console.log(`[ctrack-engine] http://${HOST}:${PORT}`)
        console.log(`[ctrack-engine] Local UI: http://${HOST}:${PORT}/`)
        console.log(`[ctrack-engine] CORS origins:`, parseCorsOrigins().join(", "))
        void (async () => {
          await new Promise((r) => setTimeout(r, 2500))
          try {
            let status = await fetchEngineStatus(pythonManager, { rescan: true })
            if (status.missing.includes("ffmpeg")) {
              console.log("[ctrack-engine] Media runtime missing — auto-provisioning FFmpeg/OIIO/OCIO...")
              try {
                await ensureMediaRuntime(getInstallRoot())
                status = await fetchEngineStatus(pythonManager, { rescan: true })
              } catch (provisionErr) {
                console.warn("[ctrack-engine] Media runtime auto-provision failed:", provisionErr)
              }
            }
            const n = status.nukeInstallations?.length ?? 0
            console.log(
              `[ctrack-engine] tools: EXR=${status.activeExrBackend ?? "none"} nuke=${n} install(s) missing=${status.missing.join(",") || "none"}`
            )
          } catch (e) {
            console.warn("[ctrack-engine] startup tool scan failed:", e)
          }
        })()
        resolve(httpServer!)
      })
      httpServer.on("error", reject)
    } catch (e) {
      reject(e)
    }
  })
}

export function stopEngine(): Promise<void> {
  pythonManager.stop()
  return new Promise((resolve, reject) => {
    if (!httpServer) {
      resolve()
      return
    }
    httpServer.close((err) => {
      httpServer = null
      if (err) reject(err)
      else resolve()
    })
  })
}

if (isRunAsNodeMainScript()) {
  startEngine().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
